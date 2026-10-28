/**
 * The active case: the frozen baseline + the hypothetical payment delay (if any) +
 * accepted proposals. Pure and deterministic.
 *
 * Accepted proposals are forecast changes, not cash: they never touch the opening
 * (actual) balance, every event stays `forecast`, and receivables stay `open`.
 * Each accepted proposal stores only its own adjustments; for the same event an
 * accepted adjustment overrides the hypothetical delay (an agreement beats a what-if).
 */
import type { AcceptedChange, DemoDataset, Scenario, ScenarioAdjustment } from "./models";
import { calculateScenarioCashFlow, type ScenarioForecast } from "./scenarios";
import type { BusinessDate } from "./types";

export const ACTIVE_CASE_SCENARIO_ID = "scn-active-case";

function adjustmentKey(a: ScenarioAdjustment): string {
  return a.type === "add_event" ? `add:${a.event.id}` : `event:${a.eventId}`;
}

/** Event ids whose dates or amounts come from accepted proposals. */
export function acceptedEventIds(accepted: readonly AcceptedChange[]): Set<string> {
  const ids = new Set<string>();
  for (const change of accepted) {
    for (const a of change.adjustments) {
      if (a.type === "split_event") a.parts.forEach((p) => ids.add(p.id));
      else if (a.type === "shift_event") ids.add(a.eventId);
      else if (a.type === "add_event") ids.add(a.event.id);
    }
  }
  return ids;
}

/**
 * One scenario describing the active case, or null when it equals the baseline.
 * With no accepted proposals this is the delay scenario itself (unchanged behaviour).
 */
export function composeActiveScenario(
  dataset: DemoDataset,
  delay: Scenario | null,
  accepted: readonly AcceptedChange[],
  today: BusinessDate,
): Scenario | null {
  if (accepted.length === 0) return delay;
  let adjustments: ScenarioAdjustment[] = [...(delay?.adjustments ?? [])];
  for (const change of accepted) {
    for (const adjustment of change.adjustments) {
      const key = adjustmentKey(adjustment);
      adjustments = adjustments.filter((a) => adjustmentKey(a) !== key);
      adjustments.push(adjustment);
    }
  }
  const names = accepted.map((c) => c.label).join(", ");
  return {
    id: ACTIVE_CASE_SCENARIO_ID,
    label: delay ? `${delay.label} + accepted: ${names}` : `Accepted: ${names}`,
    description: [
      delay?.description,
      ...accepted.map((c) => `Accepted (simulated): ${c.description}`),
    ]
      .filter(Boolean)
      .join(" "),
    status: delay ? "hypothetical" : "accepted",
    baseDatasetVersion: dataset.datasetVersion,
    createdOn: today,
    adjustments,
    assumptions: [
      ...(delay?.assumptions ?? []),
      ...accepted.map((c) => ({
        id: `asm-${c.id}`,
        kind: "data" as const,
        text: `Accepted proposal (simulated response): ${c.description} This is a forecast change only. No cash has moved, the opening balance is unchanged and no invoice is marked paid.`,
      })),
    ],
    sources: [
      ...(delay ? [{ kind: "scenario" as const, id: delay.id, documentNumber: null }] : []),
      ...accepted.map((c) => ({
        kind: "action_draft" as const,
        id: c.draftId,
        documentNumber: null,
      })),
    ],
  };
}

/** Forecast for the active case, with accepted events labelled `accepted`. Null = baseline only. */
export function calculateActiveForecast(
  dataset: DemoDataset,
  delay: Scenario | null,
  accepted: readonly AcceptedChange[],
  today: BusinessDate,
): ScenarioForecast | null {
  const scenario = composeActiveScenario(dataset, delay, accepted, today);
  if (!scenario) return null;
  const forecast = calculateScenarioCashFlow(dataset, scenario, today);
  if (accepted.length === 0) return forecast;
  const ids = acceptedEventIds(accepted);
  return {
    ...forecast,
    view: {
      ...forecast.view,
      cashEvents: forecast.view.cashEvents.map((e) =>
        ids.has(e.id) ? { ...e, layer: "accepted" as const } : e,
      ),
    },
  };
}
