/**
 * Daily cash-flow calculation. Pure, deterministic, integer bani.
 *
 * Basis: daily closing balances. Events are aggregated per business date; the
 * order of movements within a day is unknown, so no intraday liquidity claim is
 * made. A day with +500 in and -1,200 out from a 1,000 opening closes at 300 and
 * is not reported as negative.
 *
 * Inputs are validated at runtime (amounts, dates, IDs, currencies) because
 * callers may pass data that did not go through the dataset schema.
 */
import { z } from "zod";

import { enumerateDates } from "./dates";
import { documentLinkIssues } from "./document-links";
import { datasetIntegrityIssues, DatasetIntegrityError } from "./integrity";
import {
  CASH_DIRECTIONS,
  CURRENCIES,
  baniSchema,
  businessDateSchema,
  idSchema,
  positiveBaniSchema,
  type Currency,
  type DemoDataset,
} from "./models";
import { bani } from "./money";
import type { Bani, BusinessDate } from "./types";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CashFlowInputError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid cash-flow input:\n- ${issues.join("\n- ")}`);
    this.name = "CashFlowInputError";
  }
}

/** Raised instead of converting between currencies. */
export class UnsupportedCurrencyError extends CashFlowInputError {
  constructor(issues: readonly string[]) {
    super(issues);
    this.name = "UnsupportedCurrencyError";
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const cashFlowEventSchema = z.object({
  id: idSchema,
  date: businessDateSchema,
  direction: z.enum(CASH_DIRECTIONS),
  amount: positiveBaniSchema,
  currency: z.string().min(1),
  source: z.object({ documentNumber: z.string().min(1).nullable() }).optional(),
  split: z
    .object({ parentId: idSchema, index: z.number().int().positive(), count: z.number().int() })
    .optional(),
});

const cashFlowRequestSchema = z.object({
  /** Reporting currency. Every amount must already be in this currency. */
  currency: z.string().min(1),
  /** Balance at the start of `horizon.start`, including all earlier history. */
  openingBalance: z.object({
    amount: baniSchema,
    currency: z.string().min(1),
    asOf: businessDateSchema,
  }),
  /** Inclusive range of business dates. */
  horizon: z.object({ start: businessDateSchema, end: businessDateSchema }),
  events: z.array(cashFlowEventSchema),
});

export type CashFlowRequest = z.input<typeof cashFlowRequestSchema>;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface DailyCashFlowRow {
  readonly date: BusinessDate;
  readonly openingBalance: Bani;
  readonly inflows: Bani;
  readonly outflows: Bani;
  readonly closingBalance: Bani;
}

export type ExclusionReason =
  /** Already reflected in the opening balance; never added again. */
  "before_horizon" | "after_horizon";

export interface ExcludedEvent {
  readonly id: string;
  readonly date: BusinessDate;
  readonly reason: ExclusionReason;
}

export interface DailyCashFlowResult {
  readonly basis: "daily_closing_balance";
  readonly currency: Currency;
  readonly horizon: { readonly start: BusinessDate; readonly end: BusinessDate };
  readonly openingBalance: Bani;
  readonly days: readonly DailyCashFlowRow[];
  readonly minimumClosingBalance: Bani;
  /** First date on which the minimum closing balance occurs. */
  readonly minimumClosingDate: BusinessDate;
  /** First date with a negative closing balance, or null if none. */
  readonly firstNegativeClosingDate: BusinessDate | null;
  /** max(0, -minimumClosingBalance). */
  readonly shortfall: Bani;
  readonly endingBalance: Bani;
  readonly includedEventIds: readonly string[];
  readonly excludedEvents: readonly ExcludedEvent[];
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

function isSupportedCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes];
}

export function calculateDailyCashFlow(request: CashFlowRequest): DailyCashFlowResult {
  const parsed = cashFlowRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new CashFlowInputError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const { currency, openingBalance, horizon, events } = parsed.data;

  // Currency: reject anything unsupported or mismatched; never convert.
  const currencyIssues: string[] = [];
  if (!isSupportedCurrency(currency)) {
    currencyIssues.push(`Reporting currency ${currency} is not supported`);
  }
  if (openingBalance.currency !== currency) {
    currencyIssues.push(
      `Opening balance is in ${openingBalance.currency}, expected ${currency}; no conversion is performed`,
    );
  }
  for (const e of events) {
    if (e.currency !== currency) {
      currencyIssues.push(
        `Event "${e.id}" is in ${e.currency}, expected ${currency}; no conversion is performed`,
      );
    }
  }
  if (currencyIssues.length > 0) throw new UnsupportedCurrencyError(currencyIssues);

  // Structural checks.
  const issues: string[] = [];
  if (horizon.start > horizon.end) {
    issues.push(`Horizon start ${horizon.start} is after end ${horizon.end}`);
  }
  if (openingBalance.asOf !== horizon.start) {
    issues.push(
      `Opening balance date ${openingBalance.asOf} must equal horizon start ${horizon.start}`,
    );
  }
  for (const id of duplicates(events.map((e) => e.id))) {
    issues.push(`Duplicate event id "${id}"`);
  }
  issues.push(...documentLinkIssues(events));
  if (issues.length > 0) throw new CashFlowInputError(issues);

  let dates: BusinessDate[];
  try {
    dates = enumerateDates(horizon.start, horizon.end);
  } catch (error) {
    throw new CashFlowInputError([(error as Error).message]);
  }

  // Aggregate by business date.
  const inflowsByDate = new Map<string, number>();
  const outflowsByDate = new Map<string, number>();
  const includedEventIds: string[] = [];
  const excludedEvents: ExcludedEvent[] = [];
  for (const e of events) {
    if (e.date < horizon.start) {
      excludedEvents.push({ id: e.id, date: e.date, reason: "before_horizon" });
      continue;
    }
    if (e.date > horizon.end) {
      excludedEvents.push({ id: e.id, date: e.date, reason: "after_horizon" });
      continue;
    }
    const target = e.direction === "inflow" ? inflowsByDate : outflowsByDate;
    target.set(e.date, bani((target.get(e.date) ?? 0) + e.amount));
    includedEventIds.push(e.id);
  }

  // Roll balances forward day by day.
  const days: DailyCashFlowRow[] = [];
  let balance: Bani = openingBalance.amount;
  for (const date of dates) {
    const inflows = bani(inflowsByDate.get(date) ?? 0);
    const outflows = bani(outflowsByDate.get(date) ?? 0);
    const closingBalance = bani(balance + inflows - outflows);
    days.push({ date, openingBalance: balance, inflows, outflows, closingBalance });
    balance = closingBalance;
  }

  // enumerateDates guarantees at least one day.
  const first = days[0]!;
  let minimumClosingBalance = first.closingBalance;
  let minimumClosingDate = first.date;
  let firstNegativeClosingDate: BusinessDate | null = null;
  for (const day of days) {
    if (day.closingBalance < minimumClosingBalance) {
      minimumClosingBalance = day.closingBalance;
      minimumClosingDate = day.date;
    }
    if (firstNegativeClosingDate === null && day.closingBalance < 0) {
      firstNegativeClosingDate = day.date;
    }
  }

  return {
    basis: "daily_closing_balance",
    currency: currency as Currency,
    horizon: { start: horizon.start, end: horizon.end },
    openingBalance: openingBalance.amount,
    days,
    minimumClosingBalance,
    minimumClosingDate,
    firstNegativeClosingDate,
    shortfall: bani(Math.max(0, -minimumClosingBalance)),
    endingBalance: days[days.length - 1]!.closingBalance,
    includedEventIds,
    excludedEvents,
  };
}

/**
 * Daily cash flow for a whole dataset. Runs dataset integrity checks first and
 * sums cash events only; receivables are documents and are never added.
 */
export function calculateDatasetCashFlow(
  dataset: DemoDataset,
  today: BusinessDate,
): DailyCashFlowResult {
  const issues = datasetIntegrityIssues(dataset, today);
  if (issues.length > 0) throw new DatasetIntegrityError(issues);
  return calculateDailyCashFlow({
    currency: dataset.profile.currency,
    openingBalance: dataset.profile.openingBalance,
    horizon: dataset.profile.horizon,
    events: dataset.cashEvents,
  });
}
