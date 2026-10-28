/**
 * Hypothetical scenarios layered on an immutable baseline. Pure and deterministic.
 *
 * A scenario stores absolute adjustments (e.g. "event X happens on date D").
 * It is always applied to the original baseline, never to a previous scenario
 * result, so re-applying it is idempotent and date changes never compound.
 * Shifted events keep their id, amount and document number; no copy is created.
 */
import { calculateDailyCashFlow, type DailyCashFlowResult, type ExcludedEvent } from "./cash-flow";
import { isBusinessDate } from "./dates";
import { datasetIntegrityIssues, DatasetIntegrityError } from "./integrity";
import type { CashEvent, DemoDataset, Receivable, Scenario } from "./models";
import { formatBani } from "./money";
import type { BusinessDate } from "./types";

/** Only one payment delay is active at a time; changing the date updates this scenario. */
export const PAYMENT_DELAY_SCENARIO_ID = "scn-payment-delay";

export class ScenarioError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Scenario cannot be applied:\n- ${issues.join("\n- ")}`);
    this.name = "ScenarioError";
  }
}

export interface MovedEvent {
  readonly id: string;
  readonly from: BusinessDate;
  readonly to: BusinessDate;
}

export interface SplitEvent {
  readonly id: string;
  readonly originalDate: BusinessDate;
  readonly parts: readonly { id: string; date: BusinessDate; amount: CashEvent["amount"] }[];
}

export interface AppliedScenario {
  readonly cashEvents: readonly CashEvent[];
  readonly receivables: readonly Receivable[];
  readonly moved: readonly MovedEvent[];
  readonly splits: readonly SplitEvent[];
}

export interface ScenarioForecast {
  readonly scenario: Scenario;
  readonly splits: readonly SplitEvent[];
  /** Baseline profile and assumptions with the scenario's events and receivables. */
  readonly view: DemoDataset;
  readonly result: DailyCashFlowResult;
  readonly moved: readonly MovedEvent[];
  /** Scenario events that fall outside the forecast horizon and are therefore not counted. */
  readonly outsideHorizon: readonly ExcludedEvent[];
}

/** Open receivables in the baseline that a delay can be applied to. */
export function delayableReceivables(dataset: DemoDataset): Receivable[] {
  return dataset.receivables.filter((r) => r.status === "open");
}

/** Validation for "delay receivable R to date D". Returns human-readable problems. */
export function validatePaymentDelay(
  dataset: DemoDataset,
  receivableId: string,
  newDate: string,
  today: BusinessDate,
): string[] {
  const receivable = dataset.receivables.find((r) => r.id === receivableId);
  if (!receivable) return [`Receivable "${receivableId}" does not exist in the active dataset`];
  if (receivable.status !== "open") return [`Receivable ${receivable.documentNumber} is not open`];
  const event = dataset.cashEvents.find((e) => e.id === receivable.cashEventId);
  if (!event) return [`Receivable ${receivable.documentNumber} has no linked cash event`];
  if (!isBusinessDate(newDate)) return [`"${newDate}" is not a valid YYYY-MM-DD date`];
  const errors: string[] = [];
  if (newDate <= event.date) {
    errors.push(
      `A delay must be later than the original expected date ${event.date} of ${receivable.documentNumber}`,
    );
  }
  if (newDate < today) errors.push(`The new date must not be before today (${today})`);
  return errors;
}

/** Builds the payment-delay scenario. Absolute: the result depends only on the baseline and the date. */
export function buildPaymentDelayScenario(
  dataset: DemoDataset,
  receivableId: string,
  newDate: string,
  today: BusinessDate,
): { ok: true; scenario: Scenario } | { ok: false; errors: string[] } {
  const errors = validatePaymentDelay(dataset, receivableId, newDate, today);
  if (errors.length > 0) return { ok: false, errors };
  const receivable = dataset.receivables.find((r) => r.id === receivableId)!;
  const event = dataset.cashEvents.find((e) => e.id === receivable.cashEventId)!;
  const date = newDate as BusinessDate;
  const outside = date > dataset.profile.horizon.end;
  return {
    ok: true,
    scenario: {
      id: PAYMENT_DELAY_SCENARIO_ID,
      label: `${receivable.documentNumber} paid on ${date}`,
      description: `Receipt of ${receivable.documentNumber} moved from ${event.date} to ${date}.`,
      status: "hypothetical",
      baseDatasetVersion: dataset.datasetVersion,
      createdOn: today,
      adjustments: [{ type: "shift_event", eventId: event.id, newDate: date }],
      assumptions: [
        {
          id: "asm-scenario-payment-delay",
          kind: "data",
          text: `Hypothetical: ${receivable.documentNumber} (${formatBani(receivable.amount)}) is received on ${date} instead of ${event.date}.${outside ? " This is after the forecast horizon, so the receipt is not counted in this forecast." : ""} The baseline is unchanged and no payment has moved.`,
        },
      ],
      sources: [
        { kind: "receivable", id: receivable.id, documentNumber: receivable.documentNumber },
      ],
    },
  };
}

/** Applies a scenario to the original baseline without mutating it. */
export function applyScenario(dataset: DemoDataset, scenario: Scenario): AppliedScenario {
  const issues: string[] = [];
  if (scenario.baseDatasetVersion !== dataset.datasetVersion) {
    issues.push(
      `Scenario was built for ${scenario.baseDatasetVersion}, but the active dataset is ${dataset.datasetVersion}`,
    );
  }
  const events = new Map(dataset.cashEvents.map((e) => [e.id, e] as const));
  const moved: MovedEvent[] = [];
  const splits: SplitEvent[] = [];
  for (const adjustment of scenario.adjustments) {
    if (adjustment.type === "add_event") {
      if (events.has(adjustment.event.id)) {
        issues.push(`Event "${adjustment.event.id}" already exists`);
      } else {
        events.set(adjustment.event.id, { ...adjustment.event, layer: "scenario" });
      }
      continue;
    }
    const original = dataset.cashEvents.find((e) => e.id === adjustment.eventId);
    if (!original) {
      issues.push(`Event "${adjustment.eventId}" does not exist in the baseline`);
      continue;
    }
    if (adjustment.type === "remove_event") {
      events.delete(original.id);
    } else if (adjustment.type === "split_event") {
      const total = adjustment.parts.reduce((sum, p) => sum + p.amount, 0);
      if (total !== original.amount) {
        issues.push(
          `Split of "${original.id}" must conserve ${formatBani(original.amount)}; parts sum to ${formatBani(total as CashEvent["amount"])}`,
        );
        continue;
      }
      const clash = adjustment.parts.find((p) => p.id !== original.id && events.has(p.id));
      if (clash) {
        issues.push(`Split part id "${clash.id}" already exists`);
        continue;
      }
      events.delete(original.id);
      adjustment.parts.forEach((part, i) => {
        events.set(part.id, {
          ...original,
          id: part.id,
          date: part.date,
          amount: part.amount,
          layer: "scenario",
          split: { parentId: original.id, index: i + 1, count: adjustment.parts.length },
        });
      });
      splits.push({ id: original.id, originalDate: original.date, parts: adjustment.parts });
    } else {
      // Absolute shift from the ORIGINAL baseline date: repeated application never compounds.
      events.set(original.id, { ...original, date: adjustment.newDate, layer: "scenario" });
      moved.push({ id: original.id, from: original.date, to: adjustment.newDate });
    }
  }
  if (issues.length > 0) throw new ScenarioError(issues);

  const cashEvents = [...events.values()].sort((a, b) =>
    a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1,
  );
  const receivables = dataset.receivables
    .filter((r) => events.has(r.cashEventId) || splits.some((s) => s.id === r.cashEventId))
    .map((r) => {
      const split = splits.find((s) => s.id === r.cashEventId);
      if (split) return { ...r, expectedDate: split.parts[split.parts.length - 1]!.date };
      const shift = moved.find((m) => m.id === r.cashEventId);
      return shift ? { ...r, expectedDate: shift.to } : r;
    });
  return { cashEvents, receivables, moved, splits };
}

/** Forecast for baseline + scenario. The baseline must pass integrity checks first. */
export function calculateScenarioCashFlow(
  dataset: DemoDataset,
  scenario: Scenario,
  today: BusinessDate,
): ScenarioForecast {
  const issues = datasetIntegrityIssues(dataset, today);
  if (issues.length > 0) throw new DatasetIntegrityError(issues);
  const applied = applyScenario(dataset, scenario);
  const result = calculateDailyCashFlow({
    currency: dataset.profile.currency,
    openingBalance: dataset.profile.openingBalance,
    horizon: dataset.profile.horizon,
    events: [...applied.cashEvents],
  });
  return {
    scenario,
    view: {
      ...dataset,
      cashEvents: [...applied.cashEvents],
      receivables: [...applied.receivables],
      assumptions: [...dataset.assumptions, ...scenario.assumptions],
    },
    result,
    moved: applied.moved,
    splits: applied.splits,
    outsideHorizon: result.excludedEvents.filter((e) => e.reason === "after_horizon"),
  };
}
