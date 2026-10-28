/**
 * CSV cash-event import. Pure: text + settings in, preview out.
 *
 * Nothing here touches application state. The UI shows the preview, and only
 * an explicit confirmation replaces the active dataset with `preview.dataset`.
 * A preview with any error has `dataset === null` and cannot be applied.
 *
 * Format, decimal rules and limits are documented in `docs/csv-import.md`.
 */
import {
  CASH_CATEGORIES,
  CURRENCIES,
  addDays,
  enumerateDates,
  formatBani,
  idSchema,
  isBusinessDate,
  parseDemoDataset,
  parseRonToBani,
  type Assumption,
  type BusinessDate,
  type BusinessProfile,
  type CashCategory,
  type CashEvent,
  type DemoDataset,
  type Receivable,
} from "@/domain";
import { bani } from "@/domain";

import { SYNTHETIC_DATA_LABEL } from "./adapter";
import { restoreFormulaEscape } from "./csv";
import { parseCsv } from "./csv-parse";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const IMPORT_LIMITS = {
  /** Maximum file size in bytes (256 KB). */
  maxBytes: 256 * 1024,
  /** Maximum number of data rows (header excluded). */
  maxRows: 2_000,
  /** Maximum forecast horizon length in days. */
  maxHorizonDays: 366,
  /** Maximum length of description and counterparty. */
  maxTextLength: 200,
  /** Maximum length of a document number. */
  maxDocumentNumberLength: 50,
} as const;

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const REQUIRED_COLUMNS = ["id", "date", "direction", "currency", "description"] as const;
const AMOUNT_COLUMNS = ["amount_bani", "amount_ron"] as const;
const OPTIONAL_COLUMNS = [
  "category",
  "status",
  "layer",
  "counterparty",
  "source_kind",
  "source_id",
  "document_number",
] as const;
const KNOWN_COLUMNS = new Set<string>([
  ...REQUIRED_COLUMNS,
  ...AMOUNT_COLUMNS,
  ...OPTIONAL_COLUMNS,
]);

/** Source kinds an import may declare. Scenario, draft and agent sources are app-generated only. */
const IMPORT_SOURCE_KINDS = ["user", "fixture", "receivable", "supplier_invoice"] as const;
type ImportSourceKind = (typeof IMPORT_SOURCE_KINDS)[number];

const DOCUMENT_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportSettings {
  /** Opening balance in RON with a dot decimal separator, e.g. "12000.00". May be negative. */
  readonly openingBalanceRon: string;
  /** First forecast day; the opening balance applies at the start of this day. */
  readonly horizonStart: string;
  /** Last forecast day, inclusive. */
  readonly horizonEnd: string;
}

export interface ImportContext {
  readonly fileName: string;
  /** Profile whose identity (id, name, timezone) the imported dataset keeps. */
  readonly profile: Pick<BusinessProfile, "id" | "name" | "timezone">;
  readonly today: BusinessDate;
}

export interface ImportRowResult {
  readonly line: number;
  readonly values: Readonly<Record<string, string>>;
  readonly event: CashEvent | null;
  readonly errors: readonly string[];
}

export interface ImportPreview {
  readonly fileName: string;
  readonly settingsErrors: readonly string[];
  /** Problems with the file itself (size, encoding, CSV syntax, row count). */
  readonly fileErrors: readonly string[];
  readonly headerErrors: readonly string[];
  readonly rows: readonly ImportRowResult[];
  /** Cross-record problems found by the dataset integrity check. */
  readonly datasetErrors: readonly string[];
  readonly errorCount: number;
  /** The dataset to apply; null whenever anything is invalid. */
  readonly dataset: DemoDataset | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic 32-bit FNV-1a hash, used for import dataset versions. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function validateText(
  label: string,
  value: string,
  errors: string[],
  { required, max }: { required: boolean; max: number },
): string | null {
  const text = restoreFormulaEscape(value.trim());
  if (!text) {
    if (required) errors.push(`${label} is required`);
    return null;
  }
  if (text.length > max) errors.push(`${label} is longer than ${max} characters`);
  if (CONTROL_CHARS.test(text)) errors.push(`${label} contains control characters`);
  return text;
}

function validateSettings(settings: ImportSettings) {
  const errors: string[] = [];
  let openingBalance = null as ReturnType<typeof parseRonToBani> | null;
  try {
    openingBalance = parseRonToBani(settings.openingBalanceRon.trim());
  } catch {
    errors.push(
      `Opening balance "${settings.openingBalanceRon}" is not a valid RON amount (digits, optional "-", dot decimal separator, up to 2 decimals)`,
    );
  }
  const start = settings.horizonStart.trim();
  const end = settings.horizonEnd.trim();
  if (!isBusinessDate(start))
    errors.push(`Forecast start "${start}" is not a valid YYYY-MM-DD date`);
  if (!isBusinessDate(end)) errors.push(`Forecast end "${end}" is not a valid YYYY-MM-DD date`);
  if (isBusinessDate(start) && isBusinessDate(end)) {
    if (start > end) {
      errors.push("Forecast start must not be after forecast end");
    } else if (end >= addDays(start, IMPORT_LIMITS.maxHorizonDays)) {
      errors.push(`Forecast horizon is longer than ${IMPORT_LIMITS.maxHorizonDays} days`);
    }
  }
  return {
    errors,
    openingBalance,
    horizon:
      errors.length === 0 ? { start: start as BusinessDate, end: end as BusinessDate } : null,
  };
}

function emptyPreview(fileName: string, partial: Partial<ImportPreview>): ImportPreview {
  const preview = {
    fileName,
    settingsErrors: [],
    fileErrors: [],
    headerErrors: [],
    rows: [],
    datasetErrors: [],
    dataset: null,
    ...partial,
  };
  return { ...preview, errorCount: countErrors(preview) };
}

function countErrors(p: Omit<ImportPreview, "errorCount">): number {
  return (
    p.settingsErrors.length +
    p.fileErrors.length +
    p.headerErrors.length +
    p.datasetErrors.length +
    p.rows.reduce((n, r) => n + r.errors.length, 0)
  );
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/** Parses and validates a cash-event CSV. Never mutates anything. */
export function previewCashEventCsv(
  text: string,
  settings: ImportSettings,
  context: ImportContext,
): ImportPreview {
  const { fileName } = context;
  const settingsResult = validateSettings(settings);

  if (utf8ByteLength(text) > IMPORT_LIMITS.maxBytes) {
    return emptyPreview(fileName, {
      settingsErrors: settingsResult.errors,
      fileErrors: [`File is larger than ${IMPORT_LIMITS.maxBytes / 1024} KB`],
    });
  }
  if (text.includes("\u0000")) {
    return emptyPreview(fileName, {
      settingsErrors: settingsResult.errors,
      fileErrors: ["File is not UTF-8 text"],
    });
  }

  const parsed = parseCsv(text);
  if (!parsed.ok) {
    return emptyPreview(fileName, {
      settingsErrors: settingsResult.errors,
      fileErrors: [`CSV syntax error on line ${parsed.line}: ${parsed.message}`],
    });
  }
  const [headerRow, ...dataRows] = parsed.rows;
  if (!headerRow) {
    return emptyPreview(fileName, {
      settingsErrors: settingsResult.errors,
      fileErrors: ["File is empty; a header row is required"],
    });
  }
  if (dataRows.length > IMPORT_LIMITS.maxRows) {
    return emptyPreview(fileName, {
      settingsErrors: settingsResult.errors,
      fileErrors: [`File has ${dataRows.length} rows; the limit is ${IMPORT_LIMITS.maxRows}`],
    });
  }

  // Header validation.
  const headers = headerRow.cells.map((h) => h.trim().toLowerCase());
  const headerErrors: string[] = [];
  const seenHeaders = new Set<string>();
  for (const h of headers) {
    if (!h) headerErrors.push("Header row contains an empty column name");
    else if (seenHeaders.has(h)) headerErrors.push(`Column "${h}" appears more than once`);
    else if (!KNOWN_COLUMNS.has(h)) headerErrors.push(`Unknown column "${h}"`);
    seenHeaders.add(h);
  }
  for (const required of REQUIRED_COLUMNS) {
    if (!seenHeaders.has(required)) headerErrors.push(`Missing required column "${required}"`);
  }
  const amountColumns = AMOUNT_COLUMNS.filter((c) => seenHeaders.has(c));
  if (amountColumns.length === 0) {
    headerErrors.push('Missing amount column: provide "amount_bani" or "amount_ron"');
  } else if (amountColumns.length > 1) {
    headerErrors.push('Provide only one of "amount_bani" or "amount_ron", not both');
  }
  if (headerErrors.length > 0) {
    return emptyPreview(fileName, { settingsErrors: settingsResult.errors, headerErrors });
  }
  const amountColumn = amountColumns[0]!;

  // Row validation.
  const horizon = settingsResult.horizon;
  const firstLineById = new Map<string, number>();
  const firstLineByDocument = new Map<string, number>();
  const rows: ImportRowResult[] = dataRows.map(({ line, cells }) => {
    const errors: string[] = [];
    const values: Record<string, string> = {};
    headers.forEach((h, i) => {
      values[h] = cells[i] ?? "";
    });
    if (cells.length !== headers.length) {
      errors.push(`Row has ${cells.length} cells; the header has ${headers.length}`);
    }
    const get = (key: string) => (values[key] ?? "").trim();

    // id
    const id = get("id");
    if (!idSchema.safeParse(id).success) {
      errors.push(`id "${id}" must be a lowercase slug (a-z, 0-9, -)`);
    } else if (firstLineById.has(id)) {
      errors.push(`Duplicate id "${id}" (first used on line ${firstLineById.get(id)})`);
    } else {
      firstLineById.set(id, line);
    }

    // date
    const date = get("date");
    if (!isBusinessDate(date)) {
      errors.push(`date "${date}" is not a valid YYYY-MM-DD calendar date`);
    } else if (horizon && date < horizon.start) {
      errors.push(
        `date ${date} is before the forecast start ${horizon.start}; history belongs in the opening balance`,
      );
    } else if (horizon && date > horizon.end) {
      errors.push(`date ${date} is after the forecast end ${horizon.end}`);
    }

    // direction
    const direction = get("direction");
    if (direction !== "inflow" && direction !== "outflow") {
      errors.push(`direction "${direction}" must be "inflow" or "outflow"`);
    }

    // amount
    const rawAmount = get(amountColumn);
    let amount: number | null = null;
    if (amountColumn === "amount_bani") {
      if (!/^\d+$/.test(rawAmount) || !Number.isSafeInteger(Number(rawAmount))) {
        errors.push(`amount_bani "${rawAmount}" must be a whole number of bani (digits only)`);
      } else {
        amount = Number(rawAmount);
      }
    } else {
      try {
        if (rawAmount.startsWith("-")) throw new RangeError("negative");
        amount = parseRonToBani(rawAmount);
      } catch {
        errors.push(
          `amount_ron "${rawAmount}" must be a positive RON amount with a dot decimal separator and up to 2 decimals`,
        );
      }
    }
    if (amount !== null && amount <= 0) {
      errors.push("Amount must be greater than zero; direction carries the sign");
      amount = null;
    }

    // currency
    const currency = get("currency");
    if (!(CURRENCIES as readonly string[]).includes(currency)) {
      errors.push(
        `Unsupported currency "${currency}"; only RON is supported and amounts are never converted`,
      );
    }

    // category / status / layer
    const category = get("category") || "other";
    if (!(CASH_CATEGORIES as readonly string[]).includes(category)) {
      errors.push(`category "${category}" must be one of ${CASH_CATEGORIES.join(", ")}`);
    }
    const status = get("status") || "forecast";
    if (status !== "forecast" && status !== "actual") {
      errors.push(`status "${status}" must be "forecast" or "actual"`);
    } else if (status === "actual" && isBusinessDate(date) && date > context.today) {
      errors.push(`status "actual" is not allowed for a future date (${date})`);
    }
    const layer = get("layer");
    if (layer && layer !== "baseline") {
      errors.push(`layer "${layer}" is not allowed; imported rows always become the baseline`);
    }

    // text
    const description = validateText("description", values["description"] ?? "", errors, {
      required: true,
      max: IMPORT_LIMITS.maxTextLength,
    });
    const counterparty = validateText("counterparty", values["counterparty"] ?? "", errors, {
      required: false,
      max: IMPORT_LIMITS.maxTextLength,
    });
    const documentNumber = validateText(
      "document_number",
      values["document_number"] ?? "",
      errors,
      {
        required: false,
        max: IMPORT_LIMITS.maxDocumentNumberLength,
      },
    );
    if (documentNumber && !DOCUMENT_NUMBER_PATTERN.test(documentNumber)) {
      errors.push(
        `document_number "${documentNumber}" may only contain letters, digits and . _ / -`,
      );
    }
    if (documentNumber) {
      const key = documentNumber.toUpperCase();
      if (firstLineByDocument.has(key)) {
        errors.push(
          `Document "${documentNumber}" is already linked to line ${firstLineByDocument.get(key)}; it would be counted twice`,
        );
      } else {
        firstLineByDocument.set(key, line);
      }
    }

    // source
    const sourceKind = (get("source_kind") || "user") as ImportSourceKind;
    if (!(IMPORT_SOURCE_KINDS as readonly string[]).includes(sourceKind)) {
      errors.push(`source_kind "${sourceKind}" must be one of ${IMPORT_SOURCE_KINDS.join(", ")}`);
    }
    const sourceId = get("source_id") || id;
    if (!idSchema.safeParse(sourceId).success) {
      errors.push(`source_id "${sourceId}" must be a lowercase slug (a-z, 0-9, -)`);
    }
    if (sourceKind === "receivable") {
      if (direction !== "inflow") errors.push("A receivable row must be an inflow");
      if (!documentNumber) errors.push("A receivable row needs a document_number (invoice number)");
      if (!counterparty) errors.push("A receivable row needs a counterparty");
    }
    if (sourceKind === "supplier_invoice" && !documentNumber) {
      errors.push("A supplier invoice row needs a document_number");
    }

    const event: CashEvent | null =
      errors.length === 0
        ? {
            id,
            date: date as BusinessDate,
            direction: direction as CashEvent["direction"],
            amount: bani(amount!),
            currency: "RON",
            category: category as CashCategory,
            description: description!,
            counterparty,
            status: status as CashEvent["status"],
            layer: "baseline",
            source: { kind: sourceKind, id: sourceId, documentNumber },
          }
        : null;
    return { line, values, event, errors };
  });

  // Receivable IDs must be unique too (they come from source_id).
  const firstLineByReceivable = new Map<string, number>();
  const checkedRows = rows.map((row) => {
    if (!row.event || row.event.source.kind !== "receivable") return row;
    const rid = row.event.source.id;
    const first = firstLineByReceivable.get(rid);
    if (first !== undefined) {
      return {
        ...row,
        event: null,
        errors: [`source_id "${rid}" is already used by the receivable on line ${first}`],
      };
    }
    firstLineByReceivable.set(rid, row.line);
    return row;
  });

  const base = {
    fileName,
    settingsErrors: settingsResult.errors,
    fileErrors: [] as string[],
    headerErrors: [] as string[],
    rows: checkedRows,
    datasetErrors: [] as string[],
    dataset: null,
  };
  if (countErrors(base) > 0 || !settingsResult.horizon || settingsResult.openingBalance === null) {
    return { ...base, errorCount: countErrors(base) };
  }

  // Build and fully validate the replacement dataset.
  const cashEvents = checkedRows
    .map((r) => r.event!)
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1));
  const receivables: Receivable[] = cashEvents
    .filter((e) => e.source.kind === "receivable")
    .map((e) => ({
      id: e.source.id,
      documentNumber: e.source.documentNumber!,
      counterparty: e.counterparty!,
      amount: e.amount,
      currency: e.currency,
      expectedDate: e.date,
      status: "open",
      cashEventId: e.id,
    }));
  const { start, end } = settingsResult.horizon;
  const assumptions: Assumption[] = [
    {
      id: "asm-import-opening-balance",
      kind: "data",
      text: `The opening balance of ${formatBani(settingsResult.openingBalance)} at the start of ${start} was entered at import and already includes all historical transactions.`,
    },
    {
      id: "asm-import-source",
      kind: "data",
      text: `${cashEvents.length} cash events were imported from "${fileName}" for ${start} to ${end} (${enumerateDates(start, end).length} days).`,
    },
    {
      id: "asm-import-complete",
      kind: "simplification",
      text: "Only the imported events are forecast. Anything missing from the file (sales, taxes, fees) is assumed not to happen.",
    },
  ];
  const candidate = {
    datasetVersion: `csv-import@${fnv1a(`${text}\n${settings.openingBalanceRon}|${start}|${end}`)}`,
    source: { kind: "synthetic" as const, label: `${SYNTHETIC_DATA_LABEL} (imported CSV)` },
    profile: {
      id: context.profile.id,
      name: context.profile.name,
      currency: "RON" as const,
      timezone: context.profile.timezone,
      openingBalance: {
        amount: settingsResult.openingBalance,
        currency: "RON" as const,
        asOf: start,
        position: "start_of_day" as const,
      },
      horizon: { start, end },
    },
    cashEvents,
    receivables,
    assumptions,
  };

  try {
    const dataset = parseDemoDataset(candidate, context.today);
    return { ...base, dataset, errorCount: 0 };
  } catch (error) {
    const issues =
      error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)
        ? (error.issues as unknown[]).map((i) => (typeof i === "string" ? i : JSON.stringify(i)))
        : [error instanceof Error ? error.message : String(error)];
    const withDataset = { ...base, datasetErrors: issues };
    return { ...withDataset, errorCount: countErrors(withDataset) };
  }
}

/** Reads a File as text via FileReader (works in browsers and jsdom). Rejects oversize files before reading. */
export function readImportFile(file: File): Promise<string> {
  if (file.size > IMPORT_LIMITS.maxBytes) {
    return Promise.reject(
      new RangeError(`File is larger than ${IMPORT_LIMITS.maxBytes / 1024} KB`),
    );
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsText(file, "utf-8");
  });
}
