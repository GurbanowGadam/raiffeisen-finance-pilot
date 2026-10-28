import { describe, expect, it } from "vitest";

import { netAmount, ronToBani } from "@/domain";

import { bucharestCafeAdapter } from "./bucharest-cafe";
import { cashEventsToCsv } from "./csv";
import csvFixture from "./fixtures/bucharest-cafe.v1.cash-events.csv?raw";

const dataset = bucharestCafeAdapter.loadBaseline();
const byId = (id: string) => dataset.cashEvents.find((e) => e.id === id);

describe("Bucharest Cafe fixture", () => {
  it("has the agreed profile", () => {
    expect(dataset.datasetVersion).toBe("bucharest-cafe@1.0.0");
    expect(dataset.source.kind).toBe("synthetic");
    expect(dataset.profile.name).toBe("Bucharest Cafe");
    expect(dataset.profile.currency).toBe("RON");
    expect(dataset.profile.timezone).toBe("Europe/Bucharest");
    expect(dataset.profile.openingBalance.amount).toBe(1_200_000);
    expect(dataset.profile.openingBalance.asOf).toBe("2026-11-01");
    expect(dataset.profile.openingBalance.position).toBe("start_of_day");
    expect(dataset.profile.horizon).toEqual({ start: "2026-11-01", end: "2026-11-30" });
  });

  it("has 800 RON sales on each day 1-10 November and none after", () => {
    const sales = dataset.cashEvents.filter((e) => e.category === "sales");
    expect(sales.map((e) => e.date)).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
    ]);
    expect(sales.every((e) => e.amount === ronToBani(800) && e.direction === "inflow")).toBe(true);
  });

  it("has CAT-001 10000 RON receivable on 4 November linked to one cash event", () => {
    expect(dataset.receivables).toHaveLength(1);
    const rcv = dataset.receivables[0]!;
    expect(rcv.documentNumber).toBe("CAT-001");
    expect(rcv.amount).toBe(ronToBani(10_000));
    expect(rcv.expectedDate).toBe("2026-11-04");
    expect(byId(rcv.cashEventId)?.date).toBe("2026-11-04");
    expect(dataset.cashEvents.filter((e) => e.source.documentNumber === "CAT-001")).toHaveLength(1);
  });

  it("has rent, payroll and SUP-001 outflows on the agreed dates", () => {
    expect(byId("evt-rent-2026-11")).toMatchObject({
      date: "2026-11-05",
      amount: 600_000,
      direction: "outflow",
    });
    expect(byId("evt-payroll-2026-11")).toMatchObject({
      date: "2026-11-08",
      amount: 900_000,
      direction: "outflow",
    });
    expect(byId("evt-sup-001")).toMatchObject({
      date: "2026-11-10",
      amount: 800_000,
      direction: "outflow",
      source: { documentNumber: "SUP-001" },
    });
  });

  it("has exactly 14 baseline events, all forecast", () => {
    expect(dataset.cashEvents).toHaveLength(14);
    expect(dataset.cashEvents.every((e) => e.status === "forecast" && e.layer === "baseline")).toBe(
      true,
    );
  });

  it("nets to -5000 RON over the horizon (18000 in, 23000 out); receivables are not added again", () => {
    expect(netAmount(dataset.cashEvents)).toBe(ronToBani(-5_000));
  });

  it("labels missing post-10-November sales as a simplifying demo assumption", () => {
    const assumption = dataset.assumptions.find((a) => a.id === "asm-no-sales-after-nov-10");
    expect(assumption?.kind).toBe("simplification");
  });

  it("returns a frozen baseline that cannot be mutated", () => {
    expect(Object.isFrozen(dataset.cashEvents)).toBe(true);
    expect(Object.isFrozen(dataset.cashEvents[0])).toBe(true);
  });

  it("keeps the CSV fixture identical to the JSON fixture", () => {
    expect(csvFixture).toBe(cashEventsToCsv(dataset.cashEvents));
  });
});
