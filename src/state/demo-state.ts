/**
 * Demo session state. Pure reducer; no React, storage or network.
 *
 * The baseline is a frozen dataset (the fixture, or a confirmed CSV import).
 * Scenarios, action drafts and agent runs are layered next to it and never
 * modify it. `reset` reloads exactly the fixture baseline. Every data change
 * increments `revision`. Assistant turns (agent runs) are kept as a conversation;
 * each records the revision it ended at, so the UI labels it stale once the revision
 * moves on. `replace_dataset` swaps in a validated import and invalidates all layered
 * state, because scenarios and agent answers were computed against the old baseline.
 */
import {
  DEMO_TODAY,
  bani,
  type AcceptedChange,
  type ActionDraft,
  type ActionDraftHistoryEntry,
  type AgentRun,
  type Bani,
  type DemoDataset,
  type RejectedOption,
  type Scenario,
} from "@/domain";
import { deepFreeze } from "@/data/adapter";
import { bucharestCafeAdapter } from "@/data/bucharest-cafe";
import { BUCHAREST_CAFE_RECOVERY_TERMS } from "@/data/recovery-terms";

import { responseCheck } from "./active-case";

export type ActiveSource =
  | { readonly kind: "fixture" }
  | { readonly kind: "manual"; readonly edits: number }
  | { readonly kind: "csv_import"; readonly fileName: string; readonly rowCount: number };

export interface Invalidation {
  readonly scenarios: number;
  readonly actionDrafts: number;
  readonly agentRuns: number;
}

/**
 * Bump whenever the DemoState shape changes. Hot reload keeps reducer state
 * across code edits; the provider discards state from an older shape.
 */
export const DEMO_STATE_VERSION = 7;

/** Assistant turns kept in the conversation (oldest dropped first). */
export const MAX_AGENT_RUNS = 20;

export interface DemoState {
  readonly version: typeof DEMO_STATE_VERSION;
  readonly baseline: DemoDataset;
  /**
   * Monotonic data revision. Increments on every change to the data the forecast
   * reads (baseline, scenarios). Derived forecasts and recommendations are keyed on it.
   */
  readonly revision: number;
  readonly activeSource: ActiveSource;
  /** Minimum closing cash a recovery option must keep (bani). Default 0 RON. */
  readonly cashBuffer: Bani;
  /** Recovery options the user reported as refused; excluded from comparisons. */
  readonly rejectedOptions: readonly RejectedOption[];
  readonly scenarios: readonly Scenario[];
  readonly actionDrafts: readonly ActionDraft[];
  /**
   * Proposals whose acceptance was simulated, in acceptance order (the audit trail).
   * They change the active forecast only; the baseline and opening cash never change.
   */
  readonly acceptedChanges: readonly AcceptedChange[];
  readonly agentRuns: readonly AgentRun[];
  /** What the last dataset replacement discarded; null after reset or before any import. */
  readonly lastInvalidation: Invalidation | null;
}

export type DemoAction =
  | { readonly type: "reset" }
  | {
      readonly type: "replace_dataset";
      readonly dataset: DemoDataset;
      readonly source: Extract<ActiveSource, { kind: "csv_import" }>;
    }
  /** A validated manual ledger edit (from `applyLedgerEdit`). Clears what-ifs built on the old data. */
  | { readonly type: "edit_ledger"; readonly dataset: DemoDataset }
  | { readonly type: "upsert_scenario"; readonly scenario: Scenario }
  | { readonly type: "discard_scenario"; readonly scenarioId: string }
  | { readonly type: "set_cash_buffer"; readonly amount: Bani }
  | { readonly type: "set_rejected_options"; readonly options: readonly RejectedOption[] }
  | { readonly type: "clear_conversation" }
  | { readonly type: "mark_draft_awaiting"; readonly draftId: string; readonly at: string }
  | { readonly type: "simulate_acceptance"; readonly draftId: string; readonly at: string }
  | { readonly type: "simulate_rejection"; readonly draftId: string; readonly at: string }
  | {
      readonly type: "edit_action_draft";
      readonly draftId: string;
      readonly subject: string;
      readonly body: string;
      readonly at: string;
    }
  | { readonly type: "upsert_action_draft"; readonly draft: ActionDraft }
  | { readonly type: "record_agent_run"; readonly run: AgentRun };

export function createInitialDemoState(): DemoState {
  return {
    version: DEMO_STATE_VERSION,
    baseline: bucharestCafeAdapter.loadBaseline(),
    revision: 0,
    activeSource: { kind: "fixture" },
    cashBuffer: bani(0),
    rejectedOptions: [],
    scenarios: [],
    actionDrafts: [],
    acceptedChanges: [],
    agentRuns: [],
    lastInvalidation: null,
  };
}

/** True when a state object has the current shape (guards against stale hot-reload state). */
export function isCurrentDemoState(state: unknown): state is DemoState {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as { version?: unknown }).version === DEMO_STATE_VERSION
  );
}

function historyEntry(
  event: ActionDraftHistoryEntry["event"],
  status: ActionDraft["status"],
  at: string,
  revision: number,
): ActionDraftHistoryEntry {
  return { event, status, at, businessDate: DEMO_TODAY, revision };
}

function updateDraft(
  state: DemoState,
  draftId: string,
  change: (d: ActionDraft) => ActionDraft,
): readonly ActionDraft[] {
  return state.actionDrafts.map((d) => (d.id === draftId ? change(d) : d));
}

function upsert<T extends { readonly id: string }>(list: readonly T[], item: T): T[] {
  const index = list.findIndex((x) => x.id === item.id);
  if (index === -1) return [...list, item];
  return list.map((x, i) => (i === index ? item : x));
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "reset":
      return { ...createInitialDemoState(), revision: state.revision + 1 };
    case "replace_dataset":
      return {
        version: DEMO_STATE_VERSION,
        baseline: deepFreeze(structuredClone(action.dataset)),
        revision: state.revision + 1,
        activeSource: action.source,
        cashBuffer: state.cashBuffer,
        rejectedOptions: [],
        scenarios: [],
        actionDrafts: [],
        acceptedChanges: [],
        agentRuns: [],
        lastInvalidation: {
          scenarios: state.scenarios.length,
          actionDrafts: state.actionDrafts.length,
          agentRuns: state.agentRuns.length,
        },
      };
    case "edit_ledger":
      return {
        ...state,
        baseline: deepFreeze(structuredClone(action.dataset)),
        revision: state.revision + 1,
        activeSource: {
          kind: "manual",
          edits: state.activeSource.kind === "manual" ? state.activeSource.edits + 1 : 1,
        },
        rejectedOptions: [],
        scenarios: [],
        actionDrafts: [],
        acceptedChanges: [],
        lastInvalidation: null,
      };
    case "upsert_scenario": {
      const existing = state.scenarios.find((s) => s.id === action.scenario.id);
      // Idempotent: re-submitting an identical scenario changes nothing (no new revision).
      if (existing && JSON.stringify(existing) === JSON.stringify(action.scenario)) return state;
      return {
        ...state,
        scenarios: upsert(state.scenarios, action.scenario),
        revision: state.revision + 1,
      };
    }
    case "set_cash_buffer":
      if (action.amount === state.cashBuffer) return state;
      // The buffer changes which options pass, so recommendations must be recomputed.
      return { ...state, cashBuffer: action.amount, revision: state.revision + 1 };
    case "set_rejected_options":
      if (JSON.stringify(action.options) === JSON.stringify(state.rejectedOptions)) return state;
      // Rejections change which options are evaluated, so this is a data change.
      return { ...state, rejectedOptions: [...action.options], revision: state.revision + 1 };
    case "clear_conversation":
      return { ...state, agentRuns: [] };
    case "discard_scenario":
      if (!state.scenarios.some((s) => s.id === action.scenarioId)) return state;
      return {
        ...state,
        scenarios: state.scenarios.filter((s) => s.id !== action.scenarioId),
        revision: state.revision + 1,
      };
    case "upsert_action_draft":
      return { ...state, actionDrafts: upsert(state.actionDrafts, action.draft) };
    case "edit_action_draft": {
      const draft = state.actionDrafts.find((d) => d.id === action.draftId);
      const subject = action.subject.trim();
      const body = action.body.trim();
      if (!draft || draft.status !== "draft") return state;
      if (!subject || subject.length > 300 || !body || body.length > 20_000) return state;
      if (subject === draft.subject && body === draft.body) return state;
      return {
        ...state,
        actionDrafts: updateDraft(state, draft.id, (d) => ({
          ...d,
          subject,
          body,
          edited: true,
          history: [...d.history, historyEntry("edited", "draft", action.at, state.revision)],
        })),
      };
    }
    case "mark_draft_awaiting": {
      const draft = state.actionDrafts.find((d) => d.id === action.draftId);
      if (!draft || draft.status !== "draft" || !responseCheck(state, draft.id).ok) return state;
      // Not a data change: the forecast does not depend on it.
      return {
        ...state,
        actionDrafts: updateDraft(state, draft.id, (d) => ({
          ...d,
          status: "awaiting_response",
          history: [
            ...d.history,
            historyEntry("marked_awaiting", "awaiting_response", action.at, state.revision),
          ],
        })),
      };
    }
    case "simulate_acceptance": {
      // Idempotent: an accepted draft, or an option already accepted, changes nothing.
      const check = responseCheck(state, action.draftId);
      if (!check.ok) return state;
      const draft = check.draft;
      if (state.acceptedChanges.some((c) => c.optionId === draft.optionId)) return state;
      const terms = BUCHAREST_CAFE_RECOVERY_TERMS.find((t) => t.id === draft.optionId);
      const change: AcceptedChange = {
        id: `acc-${draft.optionId}`,
        draftId: draft.id,
        optionId: draft.optionId,
        label: terms ? `${terms.letter}. ${terms.title}` : draft.optionId,
        description: `${draft.subject} (${draft.recipientLabel}).`,
        adjustments: [...draft.basis.proposal],
        acceptedAt: action.at,
        businessDate: DEMO_TODAY,
        sourceRevision: state.revision,
        draftRevision: draft.basis.revision,
        datasetVersion: state.baseline.datasetVersion,
      };
      return {
        ...state,
        acceptedChanges: [...state.acceptedChanges, change],
        actionDrafts: updateDraft(state, draft.id, (d) => ({
          ...d,
          status: "accepted",
          history: [...d.history, historyEntry("accepted", "accepted", action.at, state.revision)],
        })),
        revision: state.revision + 1,
      };
    }
    case "simulate_rejection": {
      const draft = state.actionDrafts.find((d) => d.id === action.draftId);
      if (!draft || draft.status === "accepted" || draft.status === "rejected") return state;
      const reason = `${draft.recipientLabel} rejected the proposal (simulated)`.slice(0, 200);
      // The forecast is unchanged; the option is excluded from further comparisons, which
      // is a data change for recommendations (new revision).
      return {
        ...state,
        rejectedOptions: [
          ...state.rejectedOptions.filter((r) => r.optionId !== draft.optionId),
          { optionId: draft.optionId, reason },
        ],
        actionDrafts: updateDraft(state, draft.id, (d) => ({
          ...d,
          status: "rejected",
          history: [...d.history, historyEntry("rejected", "rejected", action.at, state.revision)],
        })),
        revision: state.revision + 1,
      };
    }
    case "record_agent_run":
      // The turn describes the session as it is now (its changes are applied first), so it
      // is stamped with this session's revision; any later data change makes it stale.
      return {
        ...state,
        agentRuns: upsert(state.agentRuns, { ...action.run, endRevision: state.revision }).slice(
          -MAX_AGENT_RUNS,
        ),
      };
  }
}
