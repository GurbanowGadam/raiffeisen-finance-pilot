import { describe, expect, it } from "vitest";

import { DEMO_TODAY, calculateDatasetCashFlow } from "@/domain";

import { bucharestCafeAdapter } from "./bucharest-cafe";
import { previewCashEventCsv } from "./csv-import";
import simpleCsv from "./fixtures/sample-import.simple.csv?raw";

const baseline = bucharestCafeAdapter.loadBaseline();

function importSimple() {
  return previewCashEventCsv(
    simpleCsv,
    { openingBalanceRon: "12000", horizonStart: "2026-11-01", horizonEnd: "2026-11-30" },
    { fileName: "bucharest-cafe-simple.csv", profile: baseline.profile, today: DEMO_TODAY },
  );
}

/** Compares what matters for money: date, direction, amount, category and invoice number. */
const shape = (events: typeof baseline.cashEvents) =>
  events
    .map((e) => ({
      date: e.date,
      direction: e.direction,
      amount: e.amount,
      category: e.category,
      documentNumber: e.source.documentNumber ?? null,
    }))
    .sort((a, b) =>
      `${a.date}${a.direction}${a.amount}`.localeCompare(`${b.date}${b.direction}${b.amount}`),
    );

describe("simple sample CSV", () => {
  it("imports with no errors", () => {
    const preview = importSimple();
    expect(preview.errorCount).toBe(0);
    expect(preview.rows).toHaveLength(14);
    expect(preview.dataset).not.toBeNull();
  });

  it("holds the same cash events as the Bucharest Cafe fixture", () => {
    const dataset = importSimple().dataset!;
    expect(shape(dataset.cashEvents)).toEqual(shape(baseline.cashEvents));
    expect(dataset.receivables.map((r) => r.documentNumber)).toEqual(["CAT-001"]);
  });

  it("gives the same forecast: lowest 7000 RON on 10 Nov, ending 7000 RON", () => {
    const result = calculateDatasetCashFlow(importSimple().dataset!, DEMO_TODAY);
    expect(result.minimumClosingBalance).toBe(700_000);
    expect(result.minimumClosingDate).toBe("2026-11-10");
    expect(result.endingBalance).toBe(700_000);
    expect(result.days).toEqual(calculateDatasetCashFlow(baseline, DEMO_TODAY).days);
  });
});
