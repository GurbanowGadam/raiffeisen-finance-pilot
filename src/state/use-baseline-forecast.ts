import { useMemo } from "react";

import {
  CashFlowInputError,
  DEMO_TODAY,
  DatasetIntegrityError,
  ScenarioError,
  calculateDatasetCashFlow,
  calculateScenarioCashFlow,
  composeActiveScenario,
  summarizeForecast,
  type AcceptedChange,
  type RecoveryComparison,
  type DailyCashFlowResult,
  type DemoDataset,
  type ForecastSummary,
  type MovedEvent,
  type Scenario,
  type ExcludedEvent,
} from "@/domain";

import { activeForecastOf, delayOf, recoveryComparisonOf } from "./active-case";
import { useDemoState } from "./demo-context";

export type BaselineForecast =
  | {
      readonly status: "ready";
      readonly result: DailyCashFlowResult;
      readonly summary: ForecastSummary;
    }
  | { readonly status: "error"; readonly message: string; readonly issues: readonly string[] };

export type ScenarioForecastState =
  | {
      readonly status: "ready";
      readonly scenario: Scenario;
      readonly view: DemoDataset;
      readonly result: DailyCashFlowResult;
      readonly summary: ForecastSummary;
      readonly moved: readonly MovedEvent[];
      readonly outsideHorizon: readonly ExcludedEvent[];
    }
  | {
      readonly status: "error";
      readonly scenario: Scenario;
      readonly message: string;
      readonly issues: readonly string[];
    };

export interface ForecastView {
  /** Data revision these forecasts and recommendations were computed for. */
  readonly revision: number;
  readonly baseline: BaselineForecast;
  /**
   * The active case (hypothetical delay + accepted proposals), or null when it equals
   * the baseline. Accepted proposals are forecast changes, never actual cash.
   */
  readonly delayed: ScenarioForecastState | null;
  /** The raw payment-delay scenario, if any. */
  readonly delayScenario: Scenario | null;
  readonly accepted: readonly AcceptedChange[];
}

function toError(error: unknown): { message: string; issues: readonly string[] } {
  if (
    error instanceof DatasetIntegrityError ||
    error instanceof CashFlowInputError ||
    error instanceof ScenarioError
  ) {
    return { message: error.name, issues: error.issues };
  }
  return {
    message: "Unexpected calculation error",
    issues: [error instanceof Error ? error.message : String(error)],
  };
}

/** Runs the deterministic calculation for any dataset. Never calls an LLM. */
export function computeForecast(dataset: DemoDataset): BaselineForecast {
  try {
    const result = calculateDatasetCashFlow(dataset, DEMO_TODAY);
    return { status: "ready", result, summary: summarizeForecast(dataset, result, DEMO_TODAY) };
  } catch (error) {
    return { status: "error", ...toError(error) };
  }
}

/** Runs baseline + scenario through the deterministic calculation. */
export function computeScenarioForecast(
  dataset: DemoDataset,
  scenario: Scenario,
): ScenarioForecastState {
  try {
    const f = calculateScenarioCashFlow(dataset, scenario, DEMO_TODAY);
    return {
      status: "ready",
      scenario,
      view: f.view,
      result: f.result,
      summary: summarizeForecast(f.view, f.result, DEMO_TODAY),
      moved: f.moved,
      outsideHorizon: f.outsideHorizon,
    };
  } catch (error) {
    return { status: "error", scenario, ...toError(error) };
  }
}

/** Active case: delay + accepted proposals. Null when it equals the baseline. */
export function computeActiveForecast(
  state: Parameters<typeof activeForecastOf>[0],
): ScenarioForecastState | null {
  const delay = delayOf(state);
  const scenario = composeActiveScenario(state.baseline, delay, state.acceptedChanges, DEMO_TODAY);
  if (!scenario) return null;
  try {
    const f = activeForecastOf(state)!;
    return {
      status: "ready",
      scenario,
      view: f.view,
      result: f.result,
      summary: summarizeForecast(f.view, f.result, DEMO_TODAY),
      moved: f.moved,
      outsideHorizon: f.outsideHorizon,
    };
  } catch (error) {
    return { status: "error", scenario, ...toError(error) };
  }
}

/** Baseline and active-case forecasts; recomputed whenever the data revision changes. */
export function useForecastView(): ForecastView {
  const state = useDemoState();
  const { baseline, scenarios, acceptedChanges, revision } = state;
  return useMemo(
    () => ({
      revision,
      baseline: computeForecast(baseline),
      delayed: computeActiveForecast({ ...state }),
      delayScenario: delayOf({ scenarios }),
      accepted: acceptedChanges,
    }),
    // `revision` changes whenever baseline, scenarios or accepted changes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseline, scenarios, acceptedChanges, revision],
  );
}

/** Baseline forecast only. */
export function useBaselineForecast(): BaselineForecast {
  return useForecastView().baseline;
}

export type RecoveryView =
  | { readonly status: "needs_delay"; readonly revision: number }
  | {
      readonly status: "error";
      readonly revision: number;
      readonly message: string;
      readonly issues: readonly string[];
    }
  | {
      readonly status: "ready";
      readonly revision: number;
      readonly comparison: RecoveryComparison;
    };

/**
 * All recovery options computed together, in one pass, from the same data revision,
 * dataset version, delay scenario and cash buffer.
 */
export function useRecoveryComparison(): RecoveryView {
  const state = useDemoState();
  const { baseline, scenarios, cashBuffer, rejectedOptions, acceptedChanges, revision } = state;
  return useMemo((): RecoveryView => {
    try {
      const comparison = recoveryComparisonOf(state);
      if (!comparison) return { status: "needs_delay", revision };
      return { status: "ready", revision, comparison };
    } catch (error) {
      return { status: "error", revision, ...toError(error) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline, scenarios, cashBuffer, rejectedOptions, acceptedChanges, revision]);
}
