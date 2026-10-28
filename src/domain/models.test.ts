import { describe, expect, it } from "vitest";

import {
  DEMO_TODAY,
  DatasetIntegrityError,
  actionDraftSchema,
  agentRunSchema,
  cashEventSchema,
  datasetIntegrityIssues,
  demoDatasetSchema,
  parseDemoDataset,
  scenarioSchema,
} from "@/domain";
import fixture from "@/data/fixtures/bucharest-cafe.v1.json";

function cloneFixture() {
  return structuredClone(fixture) as typeof fixture;
}

const validEvent = fixture.cashEvents[0]!;

describe("model validation", () => {
  it("rejects a cash event with fractional bani", () => {
    expect(cashEventSchema.safeParse({ ...validEvent, amount: 800.5 }).success).toBe(false);
  });

  it("rejects a cash event with a non-RON currency", () => {
    expect(cashEventSchema.safeParse({ ...validEvent, currency: "EUR" }).success).toBe(false);
  });

  it("rejects a negative amount (direction carries the sign)", () => {
    expect(cashEventSchema.safeParse({ ...validEvent, amount: -80000 }).success).toBe(false);
  });

  it("rejects an invalid date and unknown fields", () => {
    expect(cashEventSchema.safeParse({ ...validEvent, date: "2026-11-31" }).success).toBe(false);
    expect(cashEventSchema.safeParse({ ...validEvent, extra: 1 }).success).toBe(false);
  });

  it("rejects an ID that is not a stable lowercase slug", () => {
    expect(cashEventSchema.safeParse({ ...validEvent, id: "Event 1" }).success).toBe(false);
  });

  it("accepts a hypothetical scenario that shifts CAT-001", () => {
    const result = scenarioSchema.safeParse({
      id: "scn-delay",
      label: "CAT-001 paid late",
      description: "",
      status: "hypothetical",
      baseDatasetVersion: "bucharest-cafe@1.0.0",
      createdOn: "2026-11-01",
      adjustments: [{ type: "shift_event", eventId: "evt-cat-001", newDate: "2026-11-20" }],
      assumptions: [],
      sources: [{ kind: "receivable", id: "rcv-cat-001", documentNumber: "CAT-001" }],
    });
    expect(result.success).toBe(true);
  });

  it("only allows draft, awaiting, accepted or rejected statuses on action drafts", () => {
    const draft = {
      id: "act-1",
      kind: "customer_payment_reminder",
      format: "email",
      optionId: "recovery-partial-collection",
      scenarioId: null,
      recipientLabel: "Synthetic Events SRL",
      subject: "Reminder",
      body: "Draft body",
      status: "draft",
      createdOn: "2026-11-01",
      sources: [],
      basis: {
        datasetVersion: "bucharest-cafe@1.0.0",
        revision: 1,
        proposal: [{ type: "shift_event", eventId: "evt-cat-001", newDate: "2026-11-18" }],
        fingerprint: "0badc0de",
      },
      edited: false,
      history: [
        {
          event: "generated",
          status: "draft",
          at: "2026-10-28T12:00:00.000Z",
          businessDate: "2026-11-01",
          revision: 1,
        },
      ],
    };
    expect(actionDraftSchema.safeParse(draft).success).toBe(true);
    for (const status of ["awaiting_response", "accepted", "rejected"]) {
      expect(actionDraftSchema.safeParse({ ...draft, status }).success).toBe(true);
    }
    expect(actionDraftSchema.safeParse({ ...draft, status: "sent" }).success).toBe(false);
    expect(actionDraftSchema.safeParse({ ...draft, history: [] }).success).toBe(false);
  });

  it("rejects agent tools that are not in the allowed list", () => {
    const run = {
      id: "run-1",
      mode: "guided",
      question: "",
      answer: "Guided demo mode",
      datasetVersion: "bucharest-cafe@1.0.0",
      startRevision: 0,
      endRevision: 0,
      assumptions: [],
      rejectedToolCalls: [],
      scenarioId: null,
      status: "completed",
      startedOn: "2026-11-01",
      steps: [
        {
          kind: "tool_call",
          id: "s1",
          tool: "calculate_forecast",
          input: {},
          resultRef: null,
          ok: true,
          summary: "ok",
          errorCode: null,
          durationMs: 0.4,
          sourceIds: [],
        },
      ],
    };
    expect(agentRunSchema.safeParse(run).success).toBe(true);
    const badRun = { ...run, steps: [{ ...run.steps[0], tool: "send_email" }] };
    expect(agentRunSchema.safeParse(badRun).success).toBe(false);
  });
});

describe("dataset integrity", () => {
  it("accepts the Bucharest Cafe fixture", () => {
    const dataset = demoDatasetSchema.parse(cloneFixture());
    expect(datasetIntegrityIssues(dataset, DEMO_TODAY)).toEqual([]);
  });

  it("rejects a second cash event for invoice CAT-001 (no double counting)", () => {
    const data = cloneFixture();
    const cat = data.cashEvents.find((e) => e.id === "evt-cat-001")!;
    data.cashEvents.push({ ...cat, id: "evt-cat-001-copy" });
    expect(() => parseDemoDataset(data, DEMO_TODAY)).toThrow(/CAT-001.*more than one cash event/);
  });

  it("rejects a receivable whose amount differs from its linked cash event", () => {
    const data = cloneFixture();
    data.receivables[0]!.amount = 999900;
    expect(() => parseDemoDataset(data, DEMO_TODAY)).toThrow(DatasetIntegrityError);
  });

  it("rejects a receivable that links to a missing cash event", () => {
    const data = cloneFixture();
    data.receivables[0]!.cashEventId = "evt-missing";
    expect(() => parseDemoDataset(data, DEMO_TODAY)).toThrow(/missing cash event/);
  });

  it("rejects historical rows dated before the opening balance", () => {
    const data = cloneFixture();
    data.cashEvents.push({ ...validEvent, id: "evt-history", date: "2026-10-31" });
    expect(() => parseDemoDataset(data, DEMO_TODAY)).toThrow(/before the opening balance/);
  });

  it("rejects an actual payment dated in the future", () => {
    const data = cloneFixture();
    data.cashEvents[1]!.status = "actual";
    expect(() => parseDemoDataset(data, DEMO_TODAY)).toThrow(/marked actual/);
  });
});
