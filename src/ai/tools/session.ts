/**
 * The isolated demo session a run operates on.
 *
 * The browser owns the session (in-memory, per tab). Each request sends a snapshot;
 * the server validates it (shape + dataset integrity), works on a private copy, and
 * returns the hypothetical scenarios and drafts it created. Nothing is stored on the
 * server and no request can see another session.
 */
import { z } from "zod";

import { deepFreeze } from "@/data/adapter";
import {
  DEMO_TODAY,
  acceptedChangeSchema,
  actionDraftSchema,
  baniSchema,
  datasetIntegrityIssues,
  demoDatasetSchema,
  rejectedOptionSchema,
  scenarioSchema,
  type ActionDraft,
  type Bani,
  type RejectedOption,
  type Scenario,
} from "@/domain";
import {
  DEMO_STATE_VERSION,
  demoReducer,
  type DemoAction,
  type DemoState,
} from "@/state/demo-state";

import { AGENT_LIMITS } from "./limits";

export const sessionSnapshotSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    cashBuffer: baniSchema,
    rejectedOptions: z.array(rejectedOptionSchema),
    activeSource: z.union([
      z.object({ kind: z.literal("fixture") }).strict(),
      z.object({ kind: z.literal("manual"), edits: z.number().int().nonnegative() }).strict(),
      z
        .object({
          kind: z.literal("csv_import"),
          fileName: z.string(),
          rowCount: z.number().int().nonnegative(),
        })
        .strict(),
    ]),
    baseline: demoDatasetSchema,
    scenarios: z.array(scenarioSchema),
    actionDrafts: z.array(actionDraftSchema),
    acceptedChanges: z.array(acceptedChangeSchema),
  })
  .strict();

export type SessionSnapshot = z.input<typeof sessionSnapshotSchema>;

/** Builds the snapshot a client sends from its current demo state. */
export function snapshotFromState(state: DemoState): SessionSnapshot {
  return {
    revision: state.revision,
    cashBuffer: state.cashBuffer,
    rejectedOptions: [...state.rejectedOptions],
    activeSource: state.activeSource,
    baseline: state.baseline,
    scenarios: [...state.scenarios],
    actionDrafts: [...state.actionDrafts],
    acceptedChanges: [...state.acceptedChanges],
  };
}

/** Mutable holder for one run's private working copy. */
export interface ToolSession {
  state: DemoState;
  readonly startRevision: number;
  readonly startCashBuffer: Bani;
  readonly startRejectedOptions: readonly RejectedOption[];
  /** Questions the model asked the user via request_missing_information. */
  readonly missingInformation: string[];
  /** Ids of scenarios and drafts created or changed during this run. */
  readonly changedScenarioIds: Set<string>;
  readonly changedDraftIds: Set<string>;
}

export type SessionResult =
  | { readonly ok: true; readonly session: ToolSession }
  | { readonly ok: false; readonly issues: readonly string[] };

export function createToolSession(input: unknown): SessionResult {
  const parsed = sessionSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `session.${i.path.join(".")}: ${i.message}`),
    };
  }
  const snap = parsed.data;
  const issues = datasetIntegrityIssues(snap.baseline, DEMO_TODAY);
  if (snap.scenarios.length > AGENT_LIMITS.maxScenarios) {
    issues.push(`Too many scenarios (limit ${AGENT_LIMITS.maxScenarios})`);
  }
  if (snap.rejectedOptions.length > AGENT_LIMITS.maxScenarios) {
    issues.push(`Too many rejected options (limit ${AGENT_LIMITS.maxScenarios})`);
  }
  if (snap.acceptedChanges.some((c) => c.datasetVersion !== snap.baseline.datasetVersion)) {
    issues.push("An accepted change belongs to a different dataset version");
  }
  if (snap.actionDrafts.length > AGENT_LIMITS.maxActionDrafts) {
    issues.push(`Too many action drafts (limit ${AGENT_LIMITS.maxActionDrafts})`);
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    session: {
      state: {
        version: DEMO_STATE_VERSION,
        baseline: deepFreeze(snap.baseline),
        revision: snap.revision,
        activeSource: snap.activeSource,
        cashBuffer: snap.cashBuffer,
        rejectedOptions: snap.rejectedOptions,
        scenarios: snap.scenarios,
        actionDrafts: snap.actionDrafts,
        acceptedChanges: snap.acceptedChanges,
        agentRuns: [],
        lastInvalidation: null,
      },
      startRevision: snap.revision,
      startCashBuffer: snap.cashBuffer,
      startRejectedOptions: snap.rejectedOptions,
      missingInformation: [],
      changedScenarioIds: new Set(),
      changedDraftIds: new Set(),
    },
  };
}

/** Applies a reducer action to the private copy (same reducer the browser uses). */
export function dispatchToSession(session: ToolSession, action: DemoAction): void {
  session.state = demoReducer(session.state, action);
}

/** The hypothetical records this run created or changed, for the browser to apply. */
export interface SessionChanges {
  scenarios: Scenario[];
  actionDrafts: ActionDraft[];
  /** New planning constraints, or null when the run did not change them. */
  constraints: { cashBuffer: Bani; rejectedOptions: RejectedOption[] } | null;
}

export function sessionChanges(session: ToolSession): SessionChanges {
  const { cashBuffer, rejectedOptions } = session.state;
  const constraintsChanged =
    cashBuffer !== session.startCashBuffer ||
    JSON.stringify(rejectedOptions) !== JSON.stringify(session.startRejectedOptions);
  return {
    scenarios: session.state.scenarios.filter((s) => session.changedScenarioIds.has(s.id)),
    actionDrafts: session.state.actionDrafts.filter((d) => session.changedDraftIds.has(d.id)),
    constraints: constraintsChanged ? { cashBuffer, rejectedOptions: [...rejectedOptions] } : null,
  };
}
