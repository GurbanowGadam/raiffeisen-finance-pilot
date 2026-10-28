/**
 * Applies a completed assistant run to the browser session. Pure.
 *
 * Changes are applied only if the session has not changed since the snapshot was
 * sent (same data revision); otherwise they are stale and discarded.
 */
import type { AgentResponse } from "@/ai/agent-contract";

import type { DemoAction, DemoState } from "./demo-state";

export type ApplyPlan =
  | { readonly kind: "apply"; readonly actions: readonly DemoAction[] }
  | { readonly kind: "stale"; readonly expected: number; readonly actual: number };

export function planAgentRunApply(
  state: DemoState,
  response: Extract<AgentResponse, { ok: true }>,
): ApplyPlan {
  if (
    state.revision !== response.startRevision ||
    state.baseline.datasetVersion !== response.datasetVersion
  ) {
    return { kind: "stale", expected: response.startRevision, actual: state.revision };
  }
  const { constraints } = response.changes;
  return {
    kind: "apply",
    actions: [
      ...response.changes.scenarios.map((scenario) => ({
        type: "upsert_scenario" as const,
        scenario,
      })),
      ...(constraints
        ? [
            { type: "set_cash_buffer" as const, amount: constraints.cashBuffer },
            { type: "set_rejected_options" as const, options: constraints.rejectedOptions },
          ]
        : []),
      ...response.changes.actionDrafts.map((draft) => ({
        type: "upsert_action_draft" as const,
        draft,
      })),
      { type: "record_agent_run" as const, run: response.run },
    ],
  };
}
