import { afterEach, describe, expect, it, vi } from "vitest";

import { PAYMENT_DELAY_SCENARIO_ID, agentRunSchema, bani } from "@/domain";
import { planAgentRunApply } from "@/state/agent-apply";
import { createInitialDemoState, demoReducer } from "@/state/demo-state";

import { validateAgentRequest, type AgentResponse } from "./agent-contract";
import { executeAgentRun } from "./agent.server";
import { GUIDED_MODE_LABEL } from "./guided";
import { AGENT_LIMITS } from "./tools/limits";
import { snapshotFromState } from "./tools/session";

const request = (mode: "guided" | "live", question = "") =>
  validateAgentRequest({
    mode,
    question,
    history: [],
    session: structuredClone(snapshotFromState(createInitialDemoState())),
  });

function okResponse(r: AgentResponse) {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r;
}

afterEach(() => vi.unstubAllEnvs());

describe("validateAgentRequest", () => {
  it("rejects requests over the size limit", () => {
    const r = validateAgentRequest({
      mode: "guided",
      question: "",
      session: { pad: "x".repeat(AGENT_LIMITS.maxRequestBytes) },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("request_too_large");
  });

  it("rejects bad modes, long questions and empty live questions", () => {
    const session = snapshotFromState(createInitialDemoState());
    for (const raw of [
      { mode: "auto", question: "x", session },
      { mode: "guided", question: "x".repeat(AGENT_LIMITS.maxQuestionChars + 1), session },
      { mode: "live", question: "   ", session },
      { mode: "guided", question: "x" },
    ]) {
      const r = validateAgentRequest(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_request");
    }
  });
});

describe("guided demo mode", () => {
  it("runs the fixed real tool sequence and labels itself as not live AI", async () => {
    const r = okResponse(await executeAgentRun(request("guided", "anything")));
    expect(r.mode).toBe("guided");
    expect(r.trace.map((t) => t.tool)).toEqual([
      "get_business_context",
      "calculate_forecast",
      "simulate_payment_delay",
      "calculate_forecast",
      "compare_recovery_scenarios",
    ]);
    expect(r.trace.every((t) => t.ok)).toBe(true);
    expect(r.answer.startsWith(GUIDED_MODE_LABEL)).toBe(true);
    expect(r.answer).toContain("-3,000.00 RON");
    expect(r.answer).toContain("2026-11-18");
    expect(r.answer).toMatch(/Nothing was sent or paid/);
    expect(r.answer).not.toMatch(/live AI chose|Lovable AI/);
  });

  it("is deterministic", async () => {
    const a = okResponse(await executeAgentRun(request("guided")));
    const b = okResponse(await executeAgentRun(request("guided")));
    expect(a.answer).toBe(b.answer);
    expect(a.trace.map((t) => [t.tool, t.input, t.summary])).toEqual(
      b.trace.map((t) => [t.tool, t.input, t.summary]),
    );
  });

  it("returns a valid AgentRun and only hypothetical changes", async () => {
    const r = okResponse(await executeAgentRun(request("guided")));
    expect(agentRunSchema.safeParse(r.run).success).toBe(true);
    expect(r.run.steps).toEqual(r.trace);
    expect(r.changes.scenarios.map((s) => [s.id, s.status])).toEqual([
      [PAYMENT_DELAY_SCENARIO_ID, "hypothetical"],
    ]);
    expect(r.changes.actionDrafts).toHaveLength(0);
    expect(r.startRevision).toBe(0);
    expect(r.endRevision).toBe(1);
  });
});

describe("applying a run in the browser", () => {
  it("applies changes when the revision still matches", async () => {
    const r = okResponse(await executeAgentRun(request("guided")));
    const plan = planAgentRunApply(createInitialDemoState(), r);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") return;
    const state = plan.actions.reduce(demoReducer, createInitialDemoState());
    expect(state.scenarios.map((s) => s.id)).toEqual([PAYMENT_DELAY_SCENARIO_ID]);
    expect(state.agentRuns.map((x) => x.id)).toEqual([r.run.id]);
    expect(state.revision).toBe(r.endRevision);
  });

  it("keeps answers after a data change but marks them stale (older endRevision)", async () => {
    const r = okResponse(await executeAgentRun(request("guided")));
    const plan = planAgentRunApply(createInitialDemoState(), r);
    if (plan.kind !== "apply") throw new Error("expected apply");
    const state = plan.actions.reduce(demoReducer, createInitialDemoState());
    expect(state.agentRuns[0]!.endRevision).toBe(state.revision);
    for (const next of [
      demoReducer(state, { type: "set_cash_buffer", amount: bani(50_000) }),
      demoReducer(state, { type: "discard_scenario", scenarioId: PAYMENT_DELAY_SCENARIO_ID }),
    ]) {
      expect(next.agentRuns).toHaveLength(1);
      expect(next.agentRuns[0]!.endRevision).toBeLessThan(next.revision);
    }
  });

  it("discards stale results after the session changed", async () => {
    const r = okResponse(await executeAgentRun(request("guided")));
    const changed = demoReducer(createInitialDemoState(), {
      type: "set_cash_buffer",
      amount: bani(100_000),
    });
    expect(planAgentRunApply(changed, r).kind).toBe("stale");
  });
});

describe("executeAgentRun errors", () => {
  it("rejects an invalid session snapshot", async () => {
    const r = await executeAgentRun(
      validateAgentRequest({ mode: "guided", question: "", session: { revision: 0 } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_session");
  });

  it("live mode without a configured key fails clearly and runs no tools", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    const r = await executeAgentRun(request("live", "Will we run short of cash?"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("provider_not_configured");
      expect(r.trace).toHaveLength(0);
    }
  });
});
