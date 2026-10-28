import { describe, expect, it } from "vitest";

import { bucharestCafeAdapter } from "@/data/bucharest-cafe";
import fixture from "@/data/fixtures/bucharest-cafe.v1.json";
import {
  CashFlowInputError,
  DEMO_TODAY,
  DatasetIntegrityError,
  UnsupportedCurrencyError,
  addDays,
  businessDate,
  calculateDailyCashFlow,
  calculateDatasetCashFlow,
  enumerateDates,
  parseRonToBani,
  ronToBani,
  type CashFlowRequest,
  type DemoDataset,
} from "@/domain";

const RON = (amount: number) => ronToBani(amount);

function request(overrides: Partial<CashFlowRequest> = {}): CashFlowRequest {
  return {
    currency: "RON",
    openingBalance: { amount: RON(1_000), currency: "RON", asOf: "2026-11-01" },
    horizon: { start: "2026-11-01", end: "2026-11-05" },
    events: [],
    ...overrides,
  };
}

function event(
  id: string,
  date: string,
  direction: "inflow" | "outflow",
  ron: number,
  extra: Partial<CashFlowRequest["events"][number]> = {},
): CashFlowRequest["events"][number] {
  return { id, date, direction, amount: RON(ron), currency: "RON", ...extra };
}

describe("Bucharest Cafe baseline (Step 2 fixture)", () => {
  const dataset = bucharestCafeAdapter.loadBaseline();
  const result = calculateDatasetCashFlow(dataset, DEMO_TODAY);
  const day = (date: string) => result.days.find((d) => d.date === date)!;

  it("covers 1-30 November inclusive (30 days) on a daily closing basis", () => {
    expect(result.basis).toBe("daily_closing_balance");
    expect(result.days).toHaveLength(30);
    expect(result.days[0]!.date).toBe("2026-11-01");
    expect(result.days.at(-1)!.date).toBe("2026-11-30");
  });

  it("starts from the 12,000 RON opening balance", () => {
    expect(result.openingBalance).toBe(RON(12_000));
    expect(day("2026-11-01").openingBalance).toBe(RON(12_000));
    expect(day("2026-11-01").closingBalance).toBe(RON(12_800));
  });

  it("closes November 10 at 7,000 RON", () => {
    expect(day("2026-11-10")).toEqual({
      date: "2026-11-10",
      openingBalance: RON(14_200),
      inflows: RON(800),
      outflows: RON(8_000),
      closingBalance: RON(7_000),
    });
  });

  it("ends November 30 at 7,000 RON", () => {
    expect(result.endingBalance).toBe(RON(7_000));
  });

  it("has a minimum closing balance of 7,000 RON first reached on November 10", () => {
    expect(result.minimumClosingBalance).toBe(RON(7_000));
    expect(result.minimumClosingDate).toBe("2026-11-10");
  });

  it("has no negative day and no shortfall", () => {
    expect(result.firstNegativeClosingDate).toBeNull();
    expect(result.shortfall).toBe(0);
  });

  it("matches the hand-calculated closing balances for every day 1-10 November", () => {
    expect(result.days.slice(0, 10).map((d) => d.closingBalance)).toEqual(
      [12_800, 13_600, 14_400, 25_200, 20_000, 20_800, 21_600, 13_400, 14_200, 7_000].map(RON),
    );
  });

  it("aggregates same-date events: November 4 = 800 sales + 10,000 CAT-001", () => {
    expect(day("2026-11-04").inflows).toBe(RON(10_800));
    expect(day("2026-11-04").outflows).toBe(0);
  });

  it("includes all 14 baseline events and excludes none", () => {
    expect(result.includedEventIds).toHaveLength(14);
    expect(result.excludedEvents).toEqual([]);
  });
});

describe("empty calendar (no events)", () => {
  it("keeps every day flat at the opening balance", () => {
    const result = calculateDailyCashFlow(request());
    expect(result.days).toHaveLength(5);
    expect(result.days.every((d) => d.inflows === 0 && d.outflows === 0)).toBe(true);
    expect(result.days.every((d) => d.closingBalance === RON(1_000))).toBe(true);
    expect(result.minimumClosingBalance).toBe(RON(1_000));
    expect(result.minimumClosingDate).toBe("2026-11-01");
    expect(result.firstNegativeClosingDate).toBeNull();
    expect(result.shortfall).toBe(0);
    expect(result.endingBalance).toBe(RON(1_000));
  });

  it("reports a negative opening balance as a shortfall from the first day", () => {
    const result = calculateDailyCashFlow(
      request({ openingBalance: { amount: RON(-250), currency: "RON", asOf: "2026-11-01" } }),
    );
    expect(result.firstNegativeClosingDate).toBe("2026-11-01");
    expect(result.shortfall).toBe(RON(250));
  });

  it("handles a single-day horizon", () => {
    const result = calculateDailyCashFlow(
      request({ horizon: { start: "2026-11-01", end: "2026-11-01" } }),
    );
    expect(result.days).toHaveLength(1);
    expect(result.endingBalance).toBe(RON(1_000));
  });
});

describe("equal-date inflows and outflows", () => {
  it("nets same-day movements and makes no intraday negative claim", () => {
    // If the outflow happened first, cash would dip to -200 intraday. The daily basis does not claim that.
    const result = calculateDailyCashFlow(
      request({
        events: [
          event("out-1", "2026-11-02", "outflow", 1_200),
          event("in-1", "2026-11-02", "inflow", 500),
        ],
      }),
    );
    const nov2 = result.days[1]!;
    expect(nov2).toEqual({
      date: "2026-11-02",
      openingBalance: RON(1_000),
      inflows: RON(500),
      outflows: RON(1_200),
      closingBalance: RON(300),
    });
    expect(result.firstNegativeClosingDate).toBeNull();
    expect(result.minimumClosingBalance).toBe(RON(300));
  });

  it("sums several events of the same direction on one date", () => {
    const result = calculateDailyCashFlow(
      request({
        events: [
          event("a", "2026-11-03", "outflow", 400),
          event("b", "2026-11-03", "outflow", 700),
        ],
      }),
    );
    expect(result.days[2]!.outflows).toBe(RON(1_100));
    expect(result.days[2]!.closingBalance).toBe(RON(-100));
    expect(result.firstNegativeClosingDate).toBe("2026-11-03");
    expect(result.shortfall).toBe(RON(100));
  });

  it("finds the first date of a repeated minimum and the shortfall max(0, -min)", () => {
    const result = calculateDailyCashFlow(
      request({
        events: [
          event("o1", "2026-11-02", "outflow", 1_500),
          event("i1", "2026-11-03", "inflow", 600),
          event("o2", "2026-11-04", "outflow", 600),
        ],
      }),
    );
    expect(result.days.map((d) => d.closingBalance)).toEqual(
      [1_000, -500, 100, -500, -500].map(RON),
    );
    expect(result.minimumClosingBalance).toBe(RON(-500));
    expect(result.minimumClosingDate).toBe("2026-11-02");
    expect(result.firstNegativeClosingDate).toBe("2026-11-02");
    expect(result.shortfall).toBe(RON(500));
    expect(result.endingBalance).toBe(RON(-500));
  });
});

describe("events outside the horizon", () => {
  it("excludes earlier events (already in the opening balance) and later events", () => {
    const result = calculateDailyCashFlow(
      request({
        events: [
          event("history", "2026-10-31", "inflow", 5_000),
          event("inside", "2026-11-05", "outflow", 100),
          event("later", "2026-11-06", "outflow", 9_000),
        ],
      }),
    );
    expect(result.includedEventIds).toEqual(["inside"]);
    expect(result.excludedEvents).toEqual([
      { id: "history", date: "2026-10-31", reason: "before_horizon" },
      { id: "later", date: "2026-11-06", reason: "after_horizon" },
    ]);
    expect(result.endingBalance).toBe(RON(900));
  });

  it("includes events on the first and last day of the horizon", () => {
    const result = calculateDailyCashFlow(
      request({
        events: [
          event("first", "2026-11-01", "inflow", 10),
          event("last", "2026-11-05", "inflow", 20),
        ],
      }),
    );
    expect(result.endingBalance).toBe(RON(1_030));
  });
});

describe("invalid input", () => {
  it("rejects fractional, zero and negative amounts", () => {
    for (const amount of [800.5, 0, -100]) {
      expect(() =>
        calculateDailyCashFlow(
          request({
            events: [{ id: "x", date: "2026-11-02", direction: "inflow", amount, currency: "RON" }],
          }),
        ),
      ).toThrow(CashFlowInputError);
    }
  });

  it("rejects a fractional opening balance", () => {
    expect(() =>
      calculateDailyCashFlow(
        request({ openingBalance: { amount: 100.25, currency: "RON", asOf: "2026-11-01" } }),
      ),
    ).toThrow(CashFlowInputError);
  });

  it("rejects invalid dates", () => {
    expect(() =>
      calculateDailyCashFlow(request({ events: [event("x", "2026-11-31", "inflow", 1)] })),
    ).toThrow(CashFlowInputError);
    expect(() =>
      calculateDailyCashFlow(request({ events: [event("x", "02/11/2026", "inflow", 1)] })),
    ).toThrow(CashFlowInputError);
  });

  it("rejects a horizon whose start is after its end", () => {
    expect(() =>
      calculateDailyCashFlow(
        request({
          horizon: { start: "2026-11-05", end: "2026-11-01" },
          openingBalance: { amount: RON(0), currency: "RON", asOf: "2026-11-05" },
        }),
      ),
    ).toThrow(/after end/);
  });

  it("rejects an opening balance not dated at the horizon start", () => {
    expect(() =>
      calculateDailyCashFlow(
        request({ openingBalance: { amount: RON(1_000), currency: "RON", asOf: "2026-10-31" } }),
      ),
    ).toThrow(/must equal horizon start/);
  });

  it("rejects duplicate event IDs", () => {
    expect(() =>
      calculateDailyCashFlow(
        request({
          events: [
            event("dup", "2026-11-02", "inflow", 1),
            event("dup", "2026-11-03", "inflow", 1),
          ],
        }),
      ),
    ).toThrow(/Duplicate event id "dup"/);
  });
});

describe("currencies", () => {
  it("rejects an unsupported reporting currency", () => {
    expect(() =>
      calculateDailyCashFlow(
        request({
          currency: "EUR",
          openingBalance: { amount: RON(1_000), currency: "EUR", asOf: "2026-11-01" },
        }),
      ),
    ).toThrow(UnsupportedCurrencyError);
  });

  it("rejects an event in another currency instead of converting it", () => {
    expect(() =>
      calculateDailyCashFlow(
        request({ events: [event("eur", "2026-11-02", "inflow", 100, { currency: "EUR" })] }),
      ),
    ).toThrow(/no conversion is performed/);
  });

  it("rejects an opening balance in another currency", () => {
    expect(() =>
      calculateDailyCashFlow(
        request({ openingBalance: { amount: RON(1_000), currency: "USD", asOf: "2026-11-01" } }),
      ),
    ).toThrow(UnsupportedCurrencyError);
  });
});

describe("decimal-to-bani conversion", () => {
  it.each([
    ["800", 80_000],
    ["800.5", 80_050],
    ["800.50", 80_050],
    ["0.1", 10],
    ["0.29", 29],
    ["1.01", 101],
    ["-12.34", -1_234],
    ["12000", 1_200_000],
  ])("parses %s RON as %i bani", (text, expected) => {
    expect(parseRonToBani(text)).toBe(expected);
  });

  it.each(["1.234", "1e3", "", "12,00", " 1", "1.", ".5", "abc"])("rejects %j", (text) => {
    expect(() => parseRonToBani(text)).toThrow(RangeError);
  });

  it("produces amounts the calculation sums exactly (0.10 + 0.20 = 0.30 RON)", () => {
    const result = calculateDailyCashFlow(
      request({
        openingBalance: { amount: parseRonToBani("0"), currency: "RON", asOf: "2026-11-01" },
        events: [
          { ...event("a", "2026-11-01", "inflow", 0), amount: parseRonToBani("0.10") },
          { ...event("b", "2026-11-01", "inflow", 0), amount: parseRonToBani("0.20") },
        ],
      }),
    );
    expect(result.endingBalance).toBe(30);
  });
});

describe("duplicate linked invoice / cash event handling", () => {
  const cloneDataset = () => structuredClone(fixture) as unknown as DemoDataset;

  it("counts CAT-001 once even though it exists as both a receivable and a cash event", () => {
    const dataset = bucharestCafeAdapter.loadBaseline();
    expect(dataset.receivables.map((r) => r.documentNumber)).toContain("CAT-001");
    const result = calculateDatasetCashFlow(dataset, DEMO_TODAY);
    const totalInflows = result.days.reduce((sum, d) => sum + d.inflows, 0);
    expect(totalInflows).toBe(RON(18_000)); // 10 x 800 sales + 10,000 CAT-001, not 28,000
  });

  it("rejects a dataset with a second cash event for invoice CAT-001", () => {
    const dataset = cloneDataset();
    const cat = dataset.cashEvents.find((e) => e.id === "evt-cat-001")!;
    (dataset.cashEvents as DemoDataset["cashEvents"][number][]).push({
      ...cat,
      id: "evt-cat-001-again",
      date: businessDate("2026-11-20"),
    });
    expect(() => calculateDatasetCashFlow(dataset, DEMO_TODAY)).toThrow(DatasetIntegrityError);
  });

  it("rejects raw events that carry the same document number twice", () => {
    expect(() =>
      calculateDailyCashFlow(
        request({
          events: [
            event("e1", "2026-11-02", "inflow", 100, { source: { documentNumber: "INV-9" } }),
            event("e2", "2026-11-03", "inflow", 100, { source: { documentNumber: "INV-9" } }),
          ],
        }),
      ),
    ).toThrow(/INV-9.*double-counted/);
  });
});

describe("date helpers", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays(businessDate("2026-11-30"), 1)).toBe("2026-12-01");
    expect(addDays(businessDate("2026-12-31"), 1)).toBe("2027-01-01");
    expect(addDays(businessDate("2028-02-28"), 1)).toBe("2028-02-29");
  });

  it("enumerates an inclusive range unaffected by the October DST change", () => {
    const dates = enumerateDates(businessDate("2026-10-24"), businessDate("2026-10-27"));
    expect(dates).toEqual(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  });
});
