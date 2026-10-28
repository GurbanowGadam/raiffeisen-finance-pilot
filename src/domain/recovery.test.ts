import { describe, expect, it } from "vitest";

import { bucharestCafeAdapter } from "@/data/bucharest-cafe";
import fixture from "@/data/fixtures/bucharest-cafe.v1.json";
import { BUCHAREST_CAFE_RECOVERY_TERMS } from "@/data/recovery-terms";

import {
  DEMO_TODAY,
  ScenarioError,
  applyScenario,
  bani,
  buildPaymentDelayScenario,
  calculateDailyCashFlow,
  calculateScenarioCashFlow,
  compareRecoveryOptions,
  ronToBani,
  type DemoDataset,
  type RecoveryOptionResult,
  type Scenario,
} from "./index";

const RON = ronToBani;
const baseline = bucharestCafeAdapter.loadBaseline();

function delayTo(date: string, dataset: DemoDataset = baseline): Scenario {
  const built = buildPaymentDelayScenario(dataset, "rcv-cat-001", date, DEMO_TODAY);
  if (!built.ok) throw new Error(built.errors.join("; "));
  return built.scenario;
}

const compare = (buffer = 0, delay = delayTo("2026-11-18"), dataset = baseline) =>
  compareRecoveryOptions(dataset, delay, BUCHAREST_CAFE_RECOVERY_TERMS, RON(buffer), DEMO_TODAY);

type Available = Extract<RecoveryOptionResult, { available: true }>;
function option(letter: string, comparison = compare()): Available {
  const o = comparison.options.find((x) => x.terms.letter === letter)!;
  if (!o.available) throw new Error(`Option ${letter} unavailable: ${o.reason}`);
  return o;
}
const closing = (o: Available, date: string) =>
  o.result.days.find((d) => d.date === date)!.closingBalance;

describe("A. Partial collection (4,000 RON of CAT-001 on 9 Nov, 6,000 RON on 18 Nov)", () => {
  const a = option("A");

  it("has minimum closing cash 1,000 RON and ending cash 7,000 RON", () => {
    expect(a.result.minimumClosingBalance).toBe(RON(1_000));
    expect(a.result.minimumClosingDate).toBe("2026-11-10");
    expect(a.result.endingBalance).toBe(RON(7_000));
    expect(closing(a, "2026-11-09")).toBe(RON(8_200));
  });

  it("conserves the 10,000 RON receivable: two parts, same document, no third copy", () => {
    const view = calculateScenarioCashFlow(baseline, a.scenario, DEMO_TODAY).view;
    const cat = view.cashEvents.filter((e) => e.source.documentNumber === "CAT-001");
    expect(cat.map((e) => [e.date, e.amount])).toEqual([
      ["2026-11-09", RON(4_000)],
      ["2026-11-18", RON(6_000)],
    ]);
    expect(cat.reduce((s, e) => s + e.amount, 0)).toBe(RON(10_000));
    expect(cat.every((e) => e.split?.parentId === "evt-cat-001" && e.split.count === 2)).toBe(true);
    expect(view.cashEvents).toHaveLength(15); // 14 baseline events, CAT-001 split into 2
  });

  it("needs customer acceptance and has no direct cost", () => {
    expect(a.status).toBe("hypothetical");
    expect(a.approvals).toEqual([
      expect.objectContaining({
        party: "Synthetic Events SRL",
        kind: "counterparty_acceptance",
        status: "not_requested",
      }),
    ]);
    expect(a.totalCost).toBe(0);
  });
});

describe("B. Supplier deferral (SUP-001: 4,000 RON on 10 Nov, 4,000 RON on 20 Nov)", () => {
  const b = option("B");

  it("has minimum closing cash 1,000 RON and ending cash 7,000 RON", () => {
    expect(b.result.minimumClosingBalance).toBe(RON(1_000));
    expect(b.result.endingBalance).toBe(RON(7_000));
    expect(closing(b, "2026-11-19")).toBe(RON(11_000));
    expect(closing(b, "2026-11-20")).toBe(RON(7_000));
  });

  it("keeps the total supplier payment at 8,000 RON", () => {
    const view = calculateScenarioCashFlow(baseline, b.scenario, DEMO_TODAY).view;
    const sup = view.cashEvents.filter((e) => e.source.documentNumber === "SUP-001");
    expect(sup.map((e) => [e.date, e.amount])).toEqual([
      ["2026-11-10", RON(4_000)],
      ["2026-11-20", RON(4_000)],
    ]);
  });

  it("labels the zero supplier fee as a demo-only assumption and needs supplier acceptance", () => {
    expect(b.costs).toEqual([expect.objectContaining({ label: "Supplier fee", amount: 0 })]);
    expect(b.disclosures.join(" ")).toMatch(/assumed to be 0 RON for this labelled demo only/);
    expect(b.approvals[0]).toMatchObject({
      party: "Synthetic Coffee Supply SRL",
      kind: "counterparty_acceptance",
    });
  });
});

describe("C. Fictional financing (3,500 in and 100 fee on 9 Nov, 3,500 repaid on 20 Nov)", () => {
  const c = option("C");

  it("has minimum closing cash 400 RON and ending cash 6,900 RON", () => {
    expect(c.result.minimumClosingBalance).toBe(RON(400));
    expect(c.result.minimumClosingDate).toBe("2026-11-10");
    expect(c.result.endingBalance).toBe(RON(6_900));
    expect(closing(c, "2026-11-09")).toBe(RON(7_600));
  });

  it("shows the 100 RON fee as its only cost and requires bank approval", () => {
    expect(c.totalCost).toBe(RON(100));
    expect(c.approvals).toEqual([
      expect.objectContaining({ kind: "bank_approval", status: "not_requested" }),
    ]);
    expect(c.disclosures.join(" ")).toMatch(/Not a real bank offer/);
  });

  it("has its repayment inside the horizon (nothing outside to disclose)", () => {
    expect(c.outsideHorizon).toEqual([]);
  });
});

describe("independence and same basis", () => {
  const comparison = compare();

  it("evaluates three options from the same dataset version and delay scenario", () => {
    expect(comparison.options).toHaveLength(3);
    expect(comparison.datasetVersion).toBe("bucharest-cafe@1.0.0");
    for (const o of comparison.options) {
      expect(o.available).toBe(true);
      if (o.available) {
        expect(o.scenario.baseDatasetVersion).toBe(comparison.datasetVersion);
        expect(o.scenario.sources).toContainEqual({
          kind: "scenario",
          id: comparison.delayScenario.id,
          documentNumber: null,
        });
      }
    }
  });

  it("never combines options: each scenario contains only the delay plus its own change", () => {
    const kinds = (letter: string) =>
      option(letter, comparison).scenario.adjustments.map((a) =>
        a.type === "add_event" ? `add:${a.event.id}` : `${a.type}:${a.eventId}`,
      );
    expect(kinds("A")).toEqual(["split_event:evt-cat-001"]);
    expect(kinds("B")).toEqual(["shift_event:evt-cat-001", "split_event:evt-sup-001"]);
    expect(kinds("C")).toEqual([
      "shift_event:evt-cat-001",
      "add:recovery-fictional-financing-disbursement",
      "add:recovery-fictional-financing-repayment",
      "add:recovery-fictional-financing-fee",
    ]);
  });

  it("reports the delayed case itself (-3,000 RON minimum) for comparison", () => {
    expect(comparison.delayed.minimumClosingBalance).toBe(RON(-3_000));
  });

  it("leaves the baseline untouched", () => {
    expect(baseline).toEqual(fixture);
  });
});

describe("cash buffer", () => {
  it("default 0 RON: all three options pass", () => {
    const c = compare(0);
    expect(c.options.map((o) => o.available && o.passesBuffer)).toEqual([true, true, true]);
    expect(c.finding).toEqual({
      kind: "options_meet_buffer",
      passing: [
        "recovery-partial-collection",
        "recovery-supplier-deferral",
        "recovery-fictional-financing",
      ],
    });
  });

  it("1,000 RON: A and B pass, C fails by 600 RON", () => {
    const c = compare(1_000);
    expect(option("A", c).passesBuffer).toBe(true);
    expect(option("B", c).passesBuffer).toBe(true);
    expect(option("C", c).passesBuffer).toBe(false);
    expect(option("C", c).bufferGap).toBe(RON(600));
  });

  it("1,500 RON: all options fail and the finding says so without inventing a solution", () => {
    const c = compare(1_500);
    expect(c.options).toHaveLength(3);
    expect(c.finding).toEqual({ kind: "all_fail", evaluated: 3, closestGap: RON(500) });
  });

  it("a buffer the delayed case already meets is reported as such", () => {
    expect(compare(-5_000).finding).toEqual({ kind: "delayed_case_meets_buffer" });
  });
});

describe("horizon handling", () => {
  it("discloses CAT-001's remainder when the delay moves it outside the horizon", () => {
    const c = compare(0, delayTo("2026-12-05"));
    const a = option("A", c);
    expect(a.outsideHorizon).toEqual([
      expect.objectContaining({
        eventId: "evt-cat-001-part-2",
        date: "2026-12-05",
        amount: RON(6_000),
      }),
    ]);
    expect(a.disclosures.join(" ")).toMatch(/Receipt outside the horizon/);
    expect(a.result.endingBalance).toBe(RON(1_000));
  });

  it("discloses repayments and deferred payments after a shorter horizon end", () => {
    const short = structuredClone(fixture) as unknown as DemoDataset;
    (short.profile.horizon as { end: string }).end = "2026-11-15";
    const c = compare(0, delayTo("2026-11-12", short), short);
    const cOpt = option("C", c);
    expect(cOpt.outsideHorizon.map((o) => o.eventId)).toEqual([
      "recovery-fictional-financing-repayment",
    ]);
    expect(cOpt.disclosures.join(" ")).toMatch(/Obligation outside the horizon.*3,500\.00 RON/);
    const bOpt = option("B", c);
    expect(bOpt.outsideHorizon.map((o) => o.eventId)).toEqual(["evt-sup-001-part-2"]);
  });
});

describe("availability and safety", () => {
  it("marks an option unavailable instead of guessing when its invoice is missing", () => {
    const noSup = structuredClone(fixture) as unknown as DemoDataset;
    noSup.cashEvents = noSup.cashEvents.filter((e) => e.id !== "evt-sup-001");
    const c = compare(0, delayTo("2026-11-18", noSup), noSup);
    const b = c.options.find((o) => o.terms.letter === "B")!;
    expect(b.available).toBe(false);
    expect(!b.available && b.reason).toMatch(/SUP-001 is not in the dataset/);
  });

  it("marks partial collection unavailable when the delayed receipt arrives before 9 Nov", () => {
    const c = compare(0, delayTo("2026-11-07"));
    const a = c.options.find((o) => o.terms.letter === "A")!;
    expect(a.available).toBe(false);
  });

  it("rejects a split whose parts do not add up to the original amount", () => {
    const bad: Scenario = {
      ...delayTo("2026-11-18"),
      adjustments: [
        {
          type: "split_event",
          eventId: "evt-cat-001",
          parts: [
            { id: "p1", date: "2026-11-09" as never, amount: bani(400_000) },
            { id: "p2", date: "2026-11-18" as never, amount: bani(500_000) },
          ],
        },
      ],
    };
    expect(() => applyScenario(baseline, bad)).toThrow(ScenarioError);
  });

  it("still rejects two unsplit events carrying the same invoice number", () => {
    expect(() =>
      calculateDailyCashFlow({
        currency: "RON",
        openingBalance: { amount: 0, currency: "RON", asOf: "2026-11-01" },
        horizon: { start: "2026-11-01", end: "2026-11-30" },
        events: [
          {
            id: "a",
            date: "2026-11-02",
            direction: "inflow",
            amount: 1,
            currency: "RON",
            source: { documentNumber: "X" },
          },
          {
            id: "b",
            date: "2026-11-03",
            direction: "inflow",
            amount: 1,
            currency: "RON",
            source: { documentNumber: "X" },
            split: { parentId: "a", index: 1, count: 2 },
          },
        ],
      }),
    ).toThrow(/double-counted/);
  });
});
