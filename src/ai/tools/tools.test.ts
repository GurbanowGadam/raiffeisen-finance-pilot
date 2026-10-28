import { asSchema } from "ai";
import { describe, expect, it } from "vitest";

import { createInitialDemoState, demoReducer, type DemoState } from "@/state/demo-state";
import { PAYMENT_DELAY_SCENARIO_ID } from "@/domain";

import type { ToolFailure, ToolResult, ToolSuccess } from "./envelope";
import { createRunContext, runTool } from "./runner";
import { TOOL_INPUT_SCHEMAS, TOOL_NAMES } from "./schemas";
import { createToolSession, sessionChanges, snapshotFromState, type ToolSession } from "./session";

const RON = 100;

function freshSession(state: DemoState = createInitialDemoState()): ToolSession {
  const r = createToolSession(structuredClone(snapshotFromState(state)));
  if (!r.ok) throw new Error(r.issues.join("; "));
  return r.session;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyData = any;
function success(r: ToolResult): ToolSuccess<AnyData> {
  if (!r.ok) throw new Error(`Expected success, got ${r.error.code}: ${r.error.message}`);
  return r as ToolSuccess<AnyData>;
}
function failure(r: ToolResult): ToolFailure {
  if (r.ok) throw new Error(`Expected failure, got: ${r.summary}`);
  return r;
}

function delayed() {
  const ctx = createRunContext(freshSession());
  success(
    runTool(ctx, "simulate_payment_delay", {
      documentNumber: "CAT-001",
      delayDays: null,
      newDate: "2026-11-18",
    }),
  );
  return ctx;
}

describe("tool schemas", () => {
  it.each(TOOL_NAMES)("%s emits a strict-compatible JSON schema", async (name) => {
    const json = (await asSchema(TOOL_INPUT_SCHEMAS[name]).jsonSchema) as {
      type: string;
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
    expect(json.type).toBe("object");
    expect(json.additionalProperties).toBe(false);
    expect([...(json.required ?? [])].sort()).toEqual(Object.keys(json.properties ?? {}).sort());
  });
});

describe("result envelope", () => {
  it("carries dataset version, revision, source ids and assumptions", () => {
    const ctx = createRunContext(freshSession());
    const r = success(
      runTool(ctx, "calculate_forecast", { view: "baseline", includeDailyRows: false }),
    );
    expect(r.datasetVersion).toBe("bucharest-cafe@1.0.0");
    expect(r.revision).toBe(0);
    expect(r.sourceIds).toContain("evt-rent-2026-11");
    expect(r.sourceIds).toHaveLength(14);
    expect(r.assumptions.length).toBeGreaterThan(0);
    expect(r.mutation).toBeNull();
  });

  it("failures carry a structured error with code and issues", () => {
    const ctx = createRunContext(freshSession());
    const r = failure(
      runTool(ctx, "get_cash_events", {
        view: "baseline",
        fromDate: "2026-13-01",
        toDate: null,
        direction: null,
        limit: null,
      }),
    );
    expect(r.error.code).toBe("invalid_input");
    expect(r.error.issues[0]).toMatch(/fromDate/);
    expect(r.datasetVersion).toBe("bucharest-cafe@1.0.0");
  });
});

describe("get_business_context", () => {
  it("returns the fixture profile and open receivable", () => {
    const ctx = createRunContext(freshSession());
    const d = success(runTool(ctx, "get_business_context", {})).data;
    expect(d.currency).toBe("RON");
    expect(d.openingBalance.bani).toBe(12_000 * RON);
    expect(d.horizon).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(d.openReceivables.map((r: { documentNumber: string }) => r.documentNumber)).toEqual([
      "CAT-001",
    ]);
    expect(d.activeDelay).toBeNull();
  });
});

describe("get_cash_events", () => {
  it("filters by direction and reports totals", () => {
    const ctx = createRunContext(freshSession());
    const d = success(
      runTool(ctx, "get_cash_events", {
        view: "baseline",
        fromDate: null,
        toDate: null,
        direction: "inflow",
        limit: null,
      }),
    ).data;
    expect(d.totalMatching).toBe(11);
    expect(d.events.every((e: { direction: string }) => e.direction === "inflow")).toBe(true);
  });

  it("rejects limits above the per-call cap and reversed ranges", () => {
    const ctx = createRunContext(freshSession());
    expect(
      failure(
        runTool(ctx, "get_cash_events", {
          view: "baseline",
          fromDate: null,
          toDate: null,
          direction: null,
          limit: 101,
        }),
      ).error.code,
    ).toBe("invalid_input");
    expect(
      failure(
        runTool(ctx, "get_cash_events", {
          view: "baseline",
          fromDate: "2026-11-10",
          toDate: "2026-11-01",
          direction: null,
          limit: null,
        }),
      ).error.code,
    ).toBe("invalid_input");
  });

  it("truncates to the limit", () => {
    const ctx = createRunContext(freshSession());
    const d = success(
      runTool(ctx, "get_cash_events", {
        view: "baseline",
        fromDate: null,
        toDate: null,
        direction: null,
        limit: 3,
      }),
    ).data;
    expect(d.events).toHaveLength(3);
    expect(d.truncated).toBe(true);
  });
});

describe("calculate_forecast", () => {
  it("baseline: lowest 7000 RON on Nov 10, no negative day, ending 7000 RON", () => {
    const ctx = createRunContext(freshSession());
    const d = success(
      runTool(ctx, "calculate_forecast", { view: "baseline", includeDailyRows: true }),
    ).data;
    expect(d.minimumClosingBalance.bani).toBe(7_000 * RON);
    expect(d.minimumClosingDate).toBe("2026-11-10");
    expect(d.firstNegativeClosingDate).toBeNull();
    expect(d.endingBalance.bani).toBe(7_000 * RON);
    expect(d.basis).toBe("daily_closing_balance");
    expect(d.dailyRows).toHaveLength(30);
  });

  it("active_case without a delay equals the baseline and says so", () => {
    const ctx = createRunContext(freshSession());
    const d = success(
      runTool(ctx, "calculate_forecast", { view: "active_case", includeDailyRows: false }),
    ).data;
    expect(d.note).toMatch(/No payment delay/);
    expect(d.minimumClosingBalance.bani).toBe(7_000 * RON);
  });
});

describe("simulate_payment_delay", () => {
  it("creates the hypothetical delay with the expected delayed-case results", () => {
    const ctx = createRunContext(freshSession());
    const r = success(
      runTool(ctx, "simulate_payment_delay", {
        documentNumber: "cat-001",
        delayDays: null,
        newDate: "2026-11-18",
      }),
    );
    expect(r.mutation).toEqual({
      kind: "scenario",
      id: PAYMENT_DELAY_SCENARIO_ID,
      change: "created",
      hypothetical: true,
    });
    expect(r.data.status).toBe("hypothetical");
    expect(r.data.delayedCase.minimumClosingBalance.bani).toBe(-3_000 * RON);
    expect(r.data.delayedCase.firstNegativeClosingDate).toBe("2026-11-10");
    expect(r.data.delayedCase.endingBalance.bani).toBe(7_000 * RON);
    expect(r.revision).toBe(1);
    expect(ctx.session.state.baseline.cashEvents.find((e) => e.id === "evt-cat-001")?.date).toBe(
      "2026-11-04",
    );
  });

  it("repeated identical calls do not duplicate or compound", () => {
    const ctx = delayed();
    const r = success(
      runTool(ctx, "simulate_payment_delay", {
        documentNumber: "CAT-001",
        delayDays: null,
        newDate: "2026-11-18",
      }),
    );
    expect(r.mutation?.change).toBe("unchanged");
    expect(r.revision).toBe(1);
    expect(ctx.session.state.scenarios).toHaveLength(1);
    const events = success(
      runTool(ctx, "get_cash_events", {
        view: "active_case",
        fromDate: null,
        toDate: null,
        direction: "inflow",
        limit: null,
      }),
    ).data;
    expect(events.events.filter((e: { id: string }) => e.id === "evt-cat-001")).toHaveLength(1);
  });

  it("rejects unknown receivables and dates that are not later", () => {
    const ctx = createRunContext(freshSession());
    expect(
      failure(
        runTool(ctx, "simulate_payment_delay", {
          documentNumber: "XYZ-9",
          delayDays: null,
          newDate: "2026-11-18",
        }),
      ).error.code,
    ).toBe("not_found");
    expect(
      failure(
        runTool(ctx, "simulate_payment_delay", {
          documentNumber: "CAT-001",
          delayDays: null,
          newDate: "2026-11-02",
        }),
      ).error.code,
    ).toBe("invalid_input");
    expect(ctx.session.state.scenarios).toHaveLength(0);
  });
});

describe("compare_recovery_scenarios", () => {
  it("requires an active delay", () => {
    const ctx = createRunContext(freshSession());
    expect(
      failure(runTool(ctx, "compare_recovery_scenarios", { bufferRon: null })).error.code,
    ).toBe("precondition_failed");
  });

  it("returns the expected A/B/C results from the same revision", () => {
    const ctx = delayed();
    const r = success(runTool(ctx, "compare_recovery_scenarios", { bufferRon: null }));
    const byLetter: AnyData = Object.fromEntries(
      r.data.options.map((o: { letter: string }) => [o.letter, o]),
    );
    expect([byLetter.A.lowestCash.bani, byLetter.A.endingCash.bani]).toEqual([
      1_000 * RON,
      7_000 * RON,
    ]);
    expect([byLetter.B.lowestCash.bani, byLetter.B.endingCash.bani]).toEqual([
      1_000 * RON,
      7_000 * RON,
    ]);
    expect([byLetter.C.lowestCash.bani, byLetter.C.endingCash.bani]).toEqual([
      400 * RON,
      6_900 * RON,
    ]);
    expect(byLetter.C.totalExplicitCost.bani).toBe(100 * RON);
    expect(r.data.basedOn).toEqual({
      datasetVersion: "bucharest-cafe@1.0.0",
      delayScenarioId: PAYMENT_DELAY_SCENARIO_ID,
      revision: 1,
    });
    expect(r.mutation).toBeNull();
  });

  it("reports when every option fails a request buffer, without changing the session buffer", () => {
    const ctx = delayed();
    const r = success(runTool(ctx, "compare_recovery_scenarios", { bufferRon: "1500.00" }));
    expect(r.data.finding.kind).toBe("all_fail");
    expect(r.data.bufferSource).toBe("request");
    expect(ctx.session.state.cashBuffer).toBe(0);
  });

  it("rejects negative or malformed buffers", () => {
    const ctx = delayed();
    expect(
      failure(runTool(ctx, "compare_recovery_scenarios", { bufferRon: "-5" })).error.code,
    ).toBe("invalid_input");
    expect(
      failure(runTool(ctx, "compare_recovery_scenarios", { bufferRon: "abc" })).error.code,
    ).toBe("invalid_input");
  });
});

describe("prepare_action_draft", () => {
  it("stores an unsent draft, idempotently", () => {
    const ctx = delayed();
    const r = success(
      runTool(ctx, "prepare_action_draft", { optionId: "recovery-supplier-deferral" }),
    );
    expect(r.mutation).toEqual({
      kind: "action_draft",
      id: "act-recovery-supplier-deferral",
      change: "created",
      hypothetical: true,
    });
    expect(r.data.draft.status).toBe("draft");
    expect(r.data.draft.body).toMatch(/Not sent/);
    expect(r.data.draft.body).toContain("- 4,000.00 RON on 10 November 2026 (2026-11-10)");
    expect(r.data.draft.body).toContain(
      "- the remaining 4,000.00 RON on 20 November 2026 (2026-11-20)",
    );
    expect(r.data.draft.body).toContain("- total payment unchanged at 8,000.00 RON");
    expect(r.data.approvalsStillRequired.length).toBeGreaterThan(0);
    const again = success(
      runTool(ctx, "prepare_action_draft", { optionId: "recovery-supplier-deferral" }),
    );
    expect(again.mutation?.change).toBe("unchanged");
    expect(ctx.session.state.actionDrafts).toHaveLength(1);
  });

  it("words the partial-collection draft from the terms and the active delay date", () => {
    const ctx = delayed();
    const r = success(
      runTool(ctx, "prepare_action_draft", { optionId: "recovery-partial-collection" }),
    );
    expect(r.data.draft.body).toContain("- 4,000.00 RON by 9 November 2026 (2026-11-09)");
    expect(r.data.draft.body).toContain(
      "- the remaining 6,000.00 RON expected on 18 November 2026 (2026-11-18)",
    );
  });

  it("requires an active delay", () => {
    const ctx = createRunContext(freshSession());
    expect(
      failure(runTool(ctx, "prepare_action_draft", { optionId: "recovery-partial-collection" }))
        .error.code,
    ).toBe("precondition_failed");
  });
});

describe("runner: validation, limits and trace", () => {
  it("rejects schema-invalid input before the handler and traces it", () => {
    const ctx = createRunContext(freshSession());
    const r = failure(
      runTool(ctx, "calculate_forecast", { view: "baseline", includeDailyRows: false, extra: 1 }),
    );
    expect(r.error.code).toBe("invalid_input");
    expect(ctx.trace).toHaveLength(1);
    expect(ctx.trace[0]).toMatchObject({
      tool: "calculate_forecast",
      ok: false,
      errorCode: "invalid_input",
    });
  });

  it("does not run or trace unknown tools", () => {
    const ctx = createRunContext(freshSession());
    expect(failure(runTool(ctx, "send_email", {})).error.code).toBe("unknown_tool");
    expect(ctx.trace).toHaveLength(0);
  });

  it("records validated input, summary and measured duration", () => {
    const ctx = createRunContext(freshSession());
    runTool(ctx, "calculate_forecast", { view: "baseline", includeDailyRows: false });
    const step = ctx.trace[0]!;
    expect(step.input).toEqual({ view: "baseline", includeDailyRows: false });
    expect(step.summary).toMatch(/lowest 7,000\.00 RON on 2026-11-10/);
    expect(step.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(step.durationMs)).toBe(true);
    expect(step.id).toBe("call-1");
  });

  it("enforces the per-run tool call limit", () => {
    const ctx = createRunContext(freshSession(), { limits: { maxToolCalls: 2 } });
    runTool(ctx, "get_business_context", {});
    runTool(ctx, "get_business_context", {});
    const r = failure(runTool(ctx, "get_business_context", {}));
    expect(r.error.code).toBe("limit_exceeded");
  });

  it("enforces the runtime budget between tool calls", () => {
    let t = 0;
    const ctx = createRunContext(freshSession(), { now: () => t, limits: { runBudgetMs: 1000 } });
    success(runTool(ctx, "get_business_context", {}));
    t = 1000;
    expect(failure(runTool(ctx, "get_business_context", {})).error.code).toBe("limit_exceeded");
  });
});

describe("session isolation", () => {
  it("never mutates the client's state and keeps sessions independent", () => {
    const client = createInitialDemoState();
    const a = createRunContext(freshSession(client));
    const b = createRunContext(freshSession(client));
    success(
      runTool(a, "simulate_payment_delay", {
        documentNumber: "CAT-001",
        delayDays: null,
        newDate: "2026-11-18",
      }),
    );
    expect(client.scenarios).toHaveLength(0);
    expect(b.session.state.scenarios).toHaveLength(0);
    expect(sessionChanges(a.session).scenarios.map((s) => s.id)).toEqual([
      PAYMENT_DELAY_SCENARIO_ID,
    ]);
    expect(sessionChanges(b.session).scenarios).toHaveLength(0);
  });

  it("rejects tampered snapshots", () => {
    const snap = structuredClone(snapshotFromState(createInitialDemoState())) as AnyData;
    snap.baseline.cashEvents[0].amount = 12.5;
    expect(createToolSession(snap).ok).toBe(false);
    const extra = {
      ...structuredClone(snapshotFromState(createInitialDemoState())),
      injected: true,
    };
    expect(createToolSession(extra).ok).toBe(false);
  });

  it("rejects snapshots over the draft limit", () => {
    let state = demoReducer(createInitialDemoState(), { type: "reset" });
    const ctx = delayed();
    success(runTool(ctx, "prepare_action_draft", { optionId: "recovery-partial-collection" }));
    const draft = ctx.session.state.actionDrafts[0]!;
    for (let i = 0; i < 51; i++) {
      state = demoReducer(state, {
        type: "upsert_action_draft",
        draft: { ...draft, id: `act-${i}` },
      });
    }
    const r = createToolSession(snapshotFromState(state));
    expect(r.ok).toBe(false);
  });
});
