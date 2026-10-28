import { describe, expect, it } from "vitest";

import fixture from "@/data/fixtures/bucharest-cafe.v1.json";
import type { ActionDraft, AgentRun, Scenario } from "@/domain";

import { createInitialDemoState, demoReducer } from "./demo-state";

const scenario = {
  id: "scn-1",
  label: "Test",
  description: "",
  status: "hypothetical",
  baseDatasetVersion: "bucharest-cafe@1.0.0",
  createdOn: "2026-11-01",
  adjustments: [{ type: "shift_event", eventId: "evt-cat-001", newDate: "2026-11-20" }],
  assumptions: [],
  sources: [],
} as unknown as Scenario;

const draft = {
  id: "act-1",
  kind: "customer_payment_reminder",
  scenarioId: "scn-1",
  recipientLabel: "Synthetic Events SRL",
  subject: "Reminder",
  body: "Draft",
  status: "accepted",
  createdOn: "2026-11-01",
  sources: [],
} as unknown as ActionDraft;

const run = {
  id: "run-1",
  datasetVersion: "bucharest-cafe@1.0.0",
  scenarioId: null,
  status: "completed",
  startedOn: "2026-11-01",
  steps: [],
} as unknown as AgentRun;

describe("Reset demo", () => {
  it("removes scenario, action and agent state and restores exactly the fixture baseline", () => {
    let state = createInitialDemoState();
    state = demoReducer(state, { type: "upsert_scenario", scenario });
    state = demoReducer(state, { type: "upsert_action_draft", draft });
    state = demoReducer(state, { type: "record_agent_run", run });
    expect(state.scenarios).toHaveLength(1);
    expect(state.actionDrafts).toHaveLength(1);
    expect(state.agentRuns).toHaveLength(1);

    const reset = demoReducer(state, { type: "reset" });
    expect(reset.scenarios).toEqual([]);
    expect(reset.actionDrafts).toEqual([]);
    expect(reset.agentRuns).toEqual([]);
    expect(reset.baseline).toEqual(fixture);
  });

  it("never modifies the baseline when scenarios are added", () => {
    const initial = createInitialDemoState();
    const next = demoReducer(initial, { type: "upsert_scenario", scenario });
    expect(next.baseline).toBe(initial.baseline);
    expect(next.baseline).toEqual(fixture);
  });
});

describe("Replace dataset (CSV import)", () => {
  it("swaps the baseline and invalidates scenarios, drafts and agent runs", () => {
    let state = createInitialDemoState();
    state = demoReducer(state, { type: "upsert_scenario", scenario });
    state = demoReducer(state, { type: "upsert_action_draft", draft });
    state = demoReducer(state, { type: "record_agent_run", run });
    const imported = { ...state.baseline, datasetVersion: "csv-import@deadbeef", cashEvents: [] };

    const next = demoReducer(state, {
      type: "replace_dataset",
      dataset: imported,
      source: { kind: "csv_import", fileName: "x.csv", rowCount: 0 },
    });
    expect(next.baseline.datasetVersion).toBe("csv-import@deadbeef");
    expect(next.baseline.cashEvents).toEqual([]);
    expect(next.scenarios).toEqual([]);
    expect(next.actionDrafts).toEqual([]);
    expect(next.agentRuns).toEqual([]);
    expect(next.lastInvalidation).toEqual({ scenarios: 1, actionDrafts: 1, agentRuns: 1 });
    expect(Object.isFrozen(next.baseline)).toBe(true);
  });

  it("Reset demo after an import restores exactly the fixture", () => {
    const imported = demoReducer(createInitialDemoState(), {
      type: "replace_dataset",
      dataset: { ...createInitialDemoState().baseline, datasetVersion: "csv-import@1" },
      source: { kind: "csv_import", fileName: "x.csv", rowCount: 14 },
    });
    const reset = demoReducer(imported, { type: "reset" });
    expect(reset.baseline).toEqual(fixture);
    expect(reset.activeSource).toEqual({ kind: "fixture" });
    expect(reset.lastInvalidation).toBeNull();
  });
});

describe("State shape guard", () => {
  it("accepts current state and rejects state from an older shape", async () => {
    const { isCurrentDemoState } = await import("./demo-state");
    expect(isCurrentDemoState(createInitialDemoState())).toBe(true);
    // Shape before Step 5 (no version, no activeSource) as kept by hot reload.
    const { version: _v, activeSource: _a, ...stale } = createInitialDemoState();
    expect(isCurrentDemoState(stale)).toBe(false);
    expect(isCurrentDemoState(null)).toBe(false);
  });
});

describe("Cash buffer setting", () => {
  it("defaults to 0 RON, bumps the revision when changed, and survives an import but not a reset", async () => {
    const { bani } = await import("@/domain");
    let state = createInitialDemoState();
    expect(state.cashBuffer).toBe(0);
    const r0 = state.revision;
    state = demoReducer(state, { type: "set_cash_buffer", amount: bani(150_000) });
    expect(state.cashBuffer).toBe(150_000);
    expect(state.revision).toBe(r0 + 1);
    expect(demoReducer(state, { type: "set_cash_buffer", amount: bani(150_000) })).toBe(state);
    const imported = demoReducer(state, {
      type: "replace_dataset",
      dataset: state.baseline,
      source: { kind: "csv_import", fileName: "x.csv", rowCount: 14 },
    });
    expect(imported.cashBuffer).toBe(150_000);
    expect(demoReducer(imported, { type: "reset" }).cashBuffer).toBe(0);
  });
});
