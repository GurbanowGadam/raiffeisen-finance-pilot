import { describe, expect, it } from "vitest";

import { bucharestCafeAdapter } from "@/data/bucharest-cafe";
import fixture from "@/data/fixtures/bucharest-cafe.v1.json";
import { createInitialDemoState, demoReducer } from "@/state/demo-state";

import {
  DEMO_TODAY,
  PAYMENT_DELAY_SCENARIO_ID,
  ScenarioError,
  applyScenario,
  buildPaymentDelayScenario,
  calculateDatasetCashFlow,
  calculateScenarioCashFlow,
  ronToBani,
  summarizeForecast,
  type Scenario,
} from "./index";

const RON = ronToBani;
const baseline = bucharestCafeAdapter.loadBaseline();

function delay(newDate: string): Scenario {
  const built = buildPaymentDelayScenario(baseline, "rcv-cat-001", newDate, DEMO_TODAY);
  if (!built.ok) throw new Error(built.errors.join("; "));
  return built.scenario;
}

const closing = (f: ReturnType<typeof calculateScenarioCashFlow>, date: string) =>
  f.result.days.find((d) => d.date === date)!.closingBalance;

describe("CAT-001 delayed from 4 Nov to 18 Nov", () => {
  const forecast = calculateScenarioCashFlow(baseline, delay("2026-11-18"), DEMO_TODAY);
  const summary = summarizeForecast(forecast.view, forecast.result, DEMO_TODAY);

  it("closes 10 November at -3,000 RON", () => {
    expect(closing(forecast, "2026-11-10")).toBe(RON(-3_000));
  });

  it("first goes negative on 10 November", () => {
    expect(forecast.result.firstNegativeClosingDate).toBe("2026-11-10");
  });

  it("has a minimum closing balance of -3,000 RON (shortfall 3,000 RON)", () => {
    expect(forecast.result.minimumClosingBalance).toBe(RON(-3_000));
    expect(forecast.result.minimumClosingDate).toBe("2026-11-10");
    expect(forecast.result.shortfall).toBe(RON(3_000));
  });

  it("closes 18 November at 7,000 RON and ends 30 November at 7,000 RON", () => {
    expect(closing(forecast, "2026-11-18")).toBe(RON(7_000));
    expect(forecast.result.endingBalance).toBe(RON(7_000));
  });

  it("stays negative 10-17 November and recovers on 18 November (temporary shortfall)", () => {
    for (const d of ["2026-11-10", "2026-11-11", "2026-11-14", "2026-11-17"]) {
      expect(closing(forecast, d)).toBe(RON(-3_000));
    }
    expect(summary.recoveryDate).toBe("2026-11-18");
    expect(summary.temporaryShortfall).toBe(true);
  });

  it("matches the hand-calculated closing balances for 1-10 November", () => {
    expect(forecast.result.days.slice(0, 10).map((d) => d.closingBalance)).toEqual(
      [12_800, 13_600, 14_400, 15_200, 10_000, 10_800, 11_600, 3_400, 4_200, -3_000].map(RON),
    );
  });

  it("moves the existing receipt: same id, same amount, one event for CAT-001", () => {
    const cat = forecast.view.cashEvents.filter((e) => e.source.documentNumber === "CAT-001");
    expect(cat).toHaveLength(1);
    expect(cat[0]).toMatchObject({
      id: "evt-cat-001",
      amount: RON(10_000),
      date: "2026-11-18",
      layer: "scenario",
    });
    expect(forecast.view.cashEvents).toHaveLength(14);
    expect(forecast.moved).toEqual([{ id: "evt-cat-001", from: "2026-11-04", to: "2026-11-18" }]);
    expect(forecast.view.receivables[0]!.expectedDate).toBe("2026-11-18");
  });

  it("leaves the baseline untouched", () => {
    expect(baseline).toEqual(fixture);
    expect(calculateDatasetCashFlow(baseline, DEMO_TODAY).endingBalance).toBe(RON(7_000));
    expect(calculateDatasetCashFlow(baseline, DEMO_TODAY).firstNegativeClosingDate).toBeNull();
  });
});

describe("repeat clicks", () => {
  it("building the same delay repeatedly gives an identical scenario", () => {
    expect(delay("2026-11-18")).toEqual(delay("2026-11-18"));
  });

  it("re-applying a scenario never compounds the date change", () => {
    const scenario = delay("2026-11-18");
    const once = applyScenario(baseline, scenario);
    const twice = applyScenario(baseline, scenario);
    expect(twice).toEqual(once);
    expect(twice.cashEvents.find((e) => e.id === "evt-cat-001")!.date).toBe("2026-11-18");
  });

  it("dispatching the same delay three times stores one scenario and one revision bump", () => {
    let state = createInitialDemoState();
    const start = state.revision;
    for (let i = 0; i < 3; i++) {
      state = demoReducer(state, { type: "upsert_scenario", scenario: delay("2026-11-18") });
    }
    expect(state.scenarios).toHaveLength(1);
    expect(state.revision).toBe(start + 1);
    const f = calculateScenarioCashFlow(state.baseline, state.scenarios[0]!, DEMO_TODAY);
    expect(f.view.cashEvents.filter((e) => e.id === "evt-cat-001")).toHaveLength(1);
    expect(closing(f, "2026-11-10")).toBe(RON(-3_000));
  });

  it("changing to a different date replaces the delay (absolute, not added to the previous one)", () => {
    let state = createInitialDemoState();
    state = demoReducer(state, { type: "upsert_scenario", scenario: delay("2026-11-18") });
    state = demoReducer(state, { type: "upsert_scenario", scenario: delay("2026-11-12") });
    expect(state.scenarios).toHaveLength(1);
    const f = calculateScenarioCashFlow(state.baseline, state.scenarios[0]!, DEMO_TODAY);
    expect(f.moved).toEqual([{ id: "evt-cat-001", from: "2026-11-04", to: "2026-11-12" }]);
    expect(closing(f, "2026-11-11")).toBe(RON(-3_000));
    expect(closing(f, "2026-11-12")).toBe(RON(7_000));
    expect(summarizeForecast(f.view, f.result, DEMO_TODAY).recoveryDate).toBe("2026-11-12");
  });
});

describe("receipt moved outside the horizon", () => {
  const forecast = calculateScenarioCashFlow(baseline, delay("2026-12-05"), DEMO_TODAY);
  const summary = summarizeForecast(forecast.view, forecast.result, DEMO_TODAY);

  it("excludes the receipt from the forecast and reports it", () => {
    expect(forecast.outsideHorizon).toEqual([
      { id: "evt-cat-001", date: "2026-12-05", reason: "after_horizon" },
    ]);
    expect(forecast.result.includedEventIds).not.toContain("evt-cat-001");
  });

  it("stays at -3,000 RON from 10 November to the end of the horizon (no recovery)", () => {
    expect(closing(forecast, "2026-11-10")).toBe(RON(-3_000));
    expect(forecast.result.endingBalance).toBe(RON(-3_000));
    expect(summary.recoveryDate).toBeNull();
    expect(summary.temporaryShortfall).toBe(false);
  });

  it("does not list the receipt among upcoming events and says so in its assumption", () => {
    expect(summary.upcomingEvents.map((e) => e.id)).not.toContain("evt-cat-001");
    expect(forecast.scenario.assumptions[0]!.text).toMatch(/after the forecast horizon/);
  });
});

describe("validation", () => {
  it.each([
    ["2026-11-04", /later than the original expected date 2026-11-04/],
    ["2026-11-02", /later than the original expected date/],
    ["2026-11-31", /not a valid YYYY-MM-DD date/],
    ["", /not a valid/],
  ])("rejects %j", (date, message) => {
    const built = buildPaymentDelayScenario(baseline, "rcv-cat-001", date, DEMO_TODAY);
    expect(built.ok).toBe(false);
    expect(!built.ok && built.errors.join(" ")).toMatch(message);
  });

  it("rejects unknown receivables", () => {
    const built = buildPaymentDelayScenario(baseline, "rcv-nope", "2026-11-18", DEMO_TODAY);
    expect(built.ok).toBe(false);
  });

  it("refuses to apply a scenario built for another dataset version", () => {
    const stale = { ...delay("2026-11-18"), baseDatasetVersion: "csv-import@00000000" };
    expect(() => applyScenario(baseline, stale)).toThrow(ScenarioError);
  });
});

describe("undo and data revision", () => {
  it("undo removes the delay and returns to the baseline only", () => {
    let state = createInitialDemoState();
    state = demoReducer(state, { type: "upsert_scenario", scenario: delay("2026-11-18") });
    const afterApply = state.revision;
    state = demoReducer(state, { type: "discard_scenario", scenarioId: PAYMENT_DELAY_SCENARIO_ID });
    expect(state.scenarios).toEqual([]);
    expect(state.revision).toBe(afterApply + 1);
    expect(state.baseline).toEqual(fixture);
  });

  it("undo twice is a no-op the second time", () => {
    let state = demoReducer(createInitialDemoState(), {
      type: "upsert_scenario",
      scenario: delay("2026-11-18"),
    });
    state = demoReducer(state, { type: "discard_scenario", scenarioId: PAYMENT_DELAY_SCENARIO_ID });
    const again = demoReducer(state, {
      type: "discard_scenario",
      scenarioId: PAYMENT_DELAY_SCENARIO_ID,
    });
    expect(again).toBe(state);
  });

  it("every data change bumps the revision; agent runs are kept and become stale", () => {
    const run = {
      id: "run-1",
      datasetVersion: baseline.datasetVersion,
      scenarioId: null,
      status: "completed",
      startedOn: "2026-11-01",
      steps: [],
    } as never;
    let state = demoReducer(createInitialDemoState(), { type: "record_agent_run", run });
    const r0 = state.revision;
    state = demoReducer(state, { type: "upsert_scenario", scenario: delay("2026-11-18") });
    expect(state.revision).toBe(r0 + 1);
    // Kept as conversation history; the UI labels runs whose endRevision is older.
    expect(state.agentRuns).toHaveLength(1);
    state = demoReducer(state, { type: "reset" });
    expect(state.revision).toBe(r0 + 2);
  });
});
