/**
 * Deterministic summary of a forecast for the dashboard: what the business
 * problem is and which records are relevant to the next action.
 * Pure; selects existing records only and never invents amounts.
 */
import type { DailyCashFlowResult } from "./cash-flow";
import type { CashEvent, DemoDataset, Receivable } from "./models";
import type { BusinessDate } from "./types";

export interface ForecastSummary {
  readonly kind: "shortfall" | "no_shortfall";
  /** Largest outflow on the day the minimum closing balance is first reached. */
  readonly lowestDayLargestOutflow: CashEvent | null;
  /** Largest open receivable expected inside the horizon on or after today. */
  readonly largestOpenReceivable: Receivable | null;
  /** Cash events from today to the horizon end, ordered by date then id. */
  readonly upcomingEvents: readonly CashEvent[];
  /** First date after the first negative close on which the closing balance is back at or above zero. */
  readonly recoveryDate: BusinessDate | null;
  /** True when there is a shortfall but the balance recovers within the horizon. */
  readonly temporaryShortfall: boolean;
}

export function summarizeForecast(
  dataset: DemoDataset,
  result: DailyCashFlowResult,
  today: BusinessDate,
): ForecastSummary {
  const upcomingEvents = dataset.cashEvents
    .filter((e) => e.date >= today && e.date <= result.horizon.end)
    .slice()
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1));

  let lowestDayLargestOutflow: CashEvent | null = null;
  for (const e of dataset.cashEvents) {
    if (e.date !== result.minimumClosingDate || e.direction !== "outflow") continue;
    if (!lowestDayLargestOutflow || e.amount > lowestDayLargestOutflow.amount) {
      lowestDayLargestOutflow = e;
    }
  }

  let largestOpenReceivable: Receivable | null = null;
  for (const r of dataset.receivables) {
    if (r.status !== "open" || r.expectedDate < today || r.expectedDate > result.horizon.end) {
      continue;
    }
    if (!largestOpenReceivable || r.amount > largestOpenReceivable.amount) {
      largestOpenReceivable = r;
    }
  }

  let recoveryDate: BusinessDate | null = null;
  if (result.firstNegativeClosingDate) {
    const recovered = result.days.find(
      (d) => d.date > result.firstNegativeClosingDate! && d.closingBalance >= 0,
    );
    recoveryDate = recovered?.date ?? null;
  }

  return {
    kind: result.shortfall > 0 ? "shortfall" : "no_shortfall",
    recoveryDate,
    temporaryShortfall: result.shortfall > 0 && recoveryDate !== null,
    lowestDayLargestOutflow,
    largestOpenReceivable,
    upcomingEvents,
  };
}
