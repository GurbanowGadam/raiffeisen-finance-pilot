/**
 * CSV serialisation of cash events. Pure; column layout is documented in
 * `docs/fixtures.md` and `docs/csv-import.md`.
 */
import type { CashEvent } from "@/domain";

export const CASH_EVENT_CSV_COLUMNS = [
  "id",
  "date",
  "direction",
  "amount_bani",
  "currency",
  "category",
  "status",
  "layer",
  "description",
  "counterparty",
  "source_kind",
  "source_id",
  "document_number",
] as const;

/** Characters that make spreadsheet apps treat a cell as a formula. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Neutralises spreadsheet formula injection in free-text cells by prefixing
 * a single quote. The importer removes exactly this prefix again.
 */
export function neutralizeFormula(value: string): string {
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

/** Reverses `neutralizeFormula`: strips one leading quote only when a trigger character follows. */
export function restoreFormulaEscape(value: string): string {
  return value.startsWith("'") && FORMULA_TRIGGER.test(value.slice(1)) ? value.slice(1) : value;
}

/** RFC 4180 quoting for commas, quotes and line breaks. */
export function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function cashEventsToCsv(events: readonly CashEvent[]): string {
  const rows = events.map((e) =>
    [
      e.id,
      e.date,
      e.direction,
      String(e.amount),
      e.currency,
      e.category,
      e.status,
      e.layer,
      neutralizeFormula(e.description),
      neutralizeFormula(e.counterparty ?? ""),
      e.source.kind,
      e.source.id,
      neutralizeFormula(e.source.documentNumber ?? ""),
    ]
      .map(escapeCsvCell)
      .join(","),
  );
  return [CASH_EVENT_CSV_COLUMNS.join(","), ...rows].join("\n") + "\n";
}
