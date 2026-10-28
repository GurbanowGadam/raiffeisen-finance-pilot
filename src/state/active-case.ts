/**
 * Pure helpers that derive the active case, the recovery comparison and draft checks
 * from DemoState. Shared by the reducer, React hooks and the assistant tools so every
 * path uses exactly the same inputs.
 */
import { BUCHAREST_CAFE_RECOVERY_TERMS } from "@/data/recovery-terms";
import {
  DEMO_TODAY,
  PAYMENT_DELAY_SCENARIO_ID,
  buildActionDraft,
  calculateActiveForecast,
  compareRecoveryOptions,
  composeActiveScenario,
  draftFreshness,
  type ActionDraft,
  type AvailableOption,
  type Bani,
  type DraftFreshness,
  type RecoveryComparison,
  type Scenario,
  type ScenarioForecast,
} from "@/domain";

import type { DemoState } from "./demo-state";

type CaseState = Pick<
  DemoState,
  "baseline" | "scenarios" | "acceptedChanges" | "rejectedOptions" | "cashBuffer" | "revision"
>;

export function delayOf(state: Pick<DemoState, "scenarios">): Scenario | null {
  return state.scenarios.find((s) => s.id === PAYMENT_DELAY_SCENARIO_ID) ?? null;
}

/** Baseline + delay + accepted proposals; null when that equals the baseline. Throws on bad data. */
export function activeForecastOf(state: CaseState): ScenarioForecast | null {
  return calculateActiveForecast(state.baseline, delayOf(state), state.acceptedChanges, DEMO_TODAY);
}

/**
 * Recovery options compared on the active case. Rejected options are excluded, accepted
 * ones are already part of the base. Null when no payment delay is active. Throws on bad data.
 */
export function recoveryComparisonOf(
  state: CaseState,
  buffer: Bani = state.cashBuffer,
): RecoveryComparison | null {
  const delay = delayOf(state);
  if (!delay) return null;
  const base = composeActiveScenario(state.baseline, delay, state.acceptedChanges, DEMO_TODAY)!;
  return compareRecoveryOptions(
    state.baseline,
    base,
    BUCHAREST_CAFE_RECOVERY_TERMS,
    buffer,
    DEMO_TODAY,
    new Map(state.rejectedOptions.map((r) => [r.optionId, r.reason])),
    new Map(
      state.acceptedChanges.map((c) => [
        c.optionId,
        `proposal accepted (simulated) on ${c.businessDate}; already in the active forecast`,
      ]),
    ),
  );
}

function safeComparison(state: CaseState): RecoveryComparison | null {
  try {
    return recoveryComparisonOf(state);
  } catch {
    return null;
  }
}

export function freshnessOf(state: CaseState, draft: ActionDraft): DraftFreshness {
  return draftFreshness(draft, safeComparison(state), state.baseline, state.revision, DEMO_TODAY);
}

/** A fresh draft for an option in the current comparison, or the reason it cannot be made. */
export function generateDraftFor(
  state: CaseState,
  optionId: string,
  at: string,
): { ok: true; draft: ActionDraft } | { ok: false; reason: string } {
  let comparison: RecoveryComparison | null;
  try {
    comparison = recoveryComparisonOf(state);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Calculation failed" };
  }
  if (!comparison) return { ok: false, reason: "No payment delay is active." };
  const option = comparison.options.find((o) => o.terms.id === optionId);
  if (!option) return { ok: false, reason: `Unknown option "${optionId}"` };
  if (!option.available) return { ok: false, reason: option.reason };
  return {
    ok: true,
    draft: buildActionDraft(option as AvailableOption, {
      dataset: state.baseline,
      comparison,
      revision: state.revision,
      businessDate: DEMO_TODAY,
      at,
    }),
  };
}

export type ResponseCheck =
  | { readonly ok: true; readonly draft: ActionDraft }
  | { readonly ok: false; readonly reason: string };

/** Whether "Simulate acceptance" (or marking as sent) is allowed for a draft right now. */
export function responseCheck(
  state: CaseState & Pick<DemoState, "actionDrafts">,
  draftId: string,
): ResponseCheck {
  const draft = state.actionDrafts.find((d) => d.id === draftId);
  if (!draft) return { ok: false, reason: "Draft not found" };
  if (draft.status === "accepted") return { ok: false, reason: "Already accepted" };
  if (draft.status === "rejected") return { ok: false, reason: "Already rejected" };
  const freshness = freshnessOf(state, draft);
  if (freshness.kind === "dataset_changed" || freshness.kind === "outdated") {
    return { ok: false, reason: freshness.reason };
  }
  return { ok: true, draft };
}
