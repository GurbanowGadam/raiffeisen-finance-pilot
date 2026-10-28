import { describe, expect, it } from "vitest";
import { bucharestCafeAdapter } from "@/data/bucharest-cafe";
import { DEMO_TODAY, bankProfile, calculateDailyCashFlow, findSolutions, simulateDelay, type BusinessDate } from "@/domain";

const ds = bucharestCafeAdapter.loadBaseline();
const invoice = ds.cashEvents.find((e) => e.source.kind === "receivable")!;

describe("delay simulator", () => {
  it("rejects a date that is not later", () => {
    expect(simulateDelay(ds, invoice.id, invoice.date).ok).toBe(false);
  });
  it("can delay any transaction, including an expense", () => {
    const rent = ds.cashEvents.find((e) => e.direction === "outflow")!;
    expect(simulateDelay(ds, rent.id, "2026-11-25" as BusinessDate).ok).toBe(true);
  });
  it("delaying the big invoice creates a gap and at least one bank fix closes it", () => {
    const r = simulateDelay(ds, invoice.id, "2026-11-18" as BusinessDate);
    if (!r.ok) throw new Error(r.error);
    expect(r.sim.after.firstNegativeClosingDate).not.toBeNull();
    const sols = findSolutions(ds, r.sim, DEMO_TODAY);
    expect(sols.some((s) => s.provider === "bank" && s.solves)).toBe(true);
    expect(sols[0]!.solves).toBe(true);
  });
  it("no gap means no fixes", () => {
    const r = simulateDelay(ds, invoice.id, addOne(invoice.date));
    if (!r.ok) throw new Error(r.error);
    if (r.sim.after.firstNegativeClosingDate === null) expect(findSolutions(ds, r.sim, DEMO_TODAY)).toEqual([]);
  });
});

describe("bank profile", () => {
  it("scores between 0 and 100", () => {
    const res = calculateDailyCashFlow({ currency: "RON", openingBalance: ds.profile.openingBalance, horizon: ds.profile.horizon, events: [...ds.cashEvents] });
    const p = bankProfile(ds, res);
    expect(p.score).toBeGreaterThanOrEqual(0);
    expect(p.score).toBeLessThanOrEqual(100);
  });
});

function addOne(d: string): BusinessDate {
  const n = new Date(d + "T00:00:00Z");
  n.setUTCDate(n.getUTCDate() + 1);
  return n.toISOString().slice(0, 10) as BusinessDate;
}

import { applyLedgerEdit, preventionPlan, type Bani } from "@/domain";
describe("prevention plan", () => {
  it("a big new expense triggers a critical warning and at least one fix that closes the gap", () => {
    const r = applyLedgerEdit(ds, { type: "add", id: "evt-user-big", entry: { date: "2026-11-02" as BusinessDate, direction: "outflow", amount: 2_000_000 as Bani, category: "other", description: "Equipment", counterparty: null } }, DEMO_TODAY);
    if (!r.ok) throw new Error("edit failed");
    const p = preventionPlan(r.dataset, DEMO_TODAY);
    expect(p.warnings[0]!.level).toBe("critical");
    expect(p.fixes.some((f) => f.solves)).toBe(true);
    expect(p.fixes.some((f) => f.id === "invoice_financing")).toBe(false);
  });
  it("the demo baseline has no critical warning", () => {
    expect(preventionPlan(ds, DEMO_TODAY).warnings.some((w) => w.level === "critical")).toBe(false);
  });
});
