import { describe, expect, it } from "vitest";

import { createRunContext, runTool } from "@/ai/tools/runner";
import { createToolSession, snapshotFromState } from "@/ai/tools/session";
import {
  DEMO_TODAY,
  bani,
  buildPaymentDelayScenario,
  calculateDatasetCashFlow,
  markdownToPlainText,
  regenerateDraft,
} from "@/domain";

import {
  activeForecastOf,
  freshnessOf,
  generateDraftFor,
  recoveryComparisonOf,
  responseCheck,
} from "./active-case";
import { createInitialDemoState, demoReducer, type DemoState } from "./demo-state";

const AT = "2026-10-28T12:00:00.000Z";
const AT2 = "2026-10-28T12:05:00.000Z";
const A = "recovery-partial-collection";
const B = "recovery-supplier-deferral";
const C = "recovery-fictional-financing";

function delayed(date = "2026-11-18", state: DemoState = createInitialDemoState()): DemoState {
  const built = buildPaymentDelayScenario(state.baseline, "rcv-cat-001", date, DEMO_TODAY);
  if (!built.ok) throw new Error(built.errors.join("; "));
  return demoReducer(state, { type: "upsert_scenario", scenario: built.scenario });
}

function withDraft(state: DemoState, optionId: string): DemoState {
  const g = generateDraftFor(state, optionId, AT);
  if (!g.ok) throw new Error(g.reason);
  return demoReducer(state, { type: "upsert_action_draft", draft: g.draft });
}

const draftOf = (state: DemoState, optionId: string) =>
  state.actionDrafts.find((d) => d.optionId === optionId)!;
const active = (state: DemoState) => activeForecastOf(state)!.result;
const accept = (state: DemoState, optionId: string, at = AT2) =>
  demoReducer(state, { type: "simulate_acceptance", draftId: draftOf(state, optionId).id, at });
const reject = (state: DemoState, optionId: string, at = AT2) =>
  demoReducer(state, { type: "simulate_rejection", draftId: draftOf(state, optionId).id, at });

describe("draft content", () => {
  it("partial collection: editable English email for CAT-001, 4,000 RON by 9 Nov, 6,000 RON on 18 Nov", () => {
    const state = withDraft(delayed(), A);
    const d = draftOf(state, A);
    expect(d).toMatchObject({
      format: "email",
      status: "draft",
      edited: false,
      kind: "customer_payment_reminder",
    });
    expect(d.subject).toContain("CAT-001");
    expect(d.body).toContain("invoice CAT-001 for 10,000.00 RON");
    expect(d.body).toContain("- 4,000.00 RON by 9 November 2026 (2026-11-09)");
    expect(d.body).toContain(
      "- the remaining 6,000.00 RON expected on 18 November 2026 (2026-11-18)",
    );
    expect(d.body).toContain("Not sent");
    expect(d.basis).toMatchObject({ datasetVersion: "bucharest-cafe@1.0.0", revision: 1 });
    expect(d.history).toEqual([
      { event: "generated", status: "draft", at: AT, businessDate: DEMO_TODAY, revision: 1 },
    ]);
  });

  it("supplier deferral: SUP-001 split 4,000 on 10 Nov and 4,000 on 20 Nov, total unchanged", () => {
    const d = draftOf(withDraft(delayed(), B), B);
    expect(d.subject).toContain("SUP-001");
    expect(d.body).toContain("- 4,000.00 RON on 10 November 2026 (2026-11-10)");
    expect(d.body).toContain("- the remaining 4,000.00 RON on 20 November 2026 (2026-11-20)");
    expect(d.body).toContain("- total payment unchanged at 8,000.00 RON");
  });

  it("financing: bank-meeting brief with gap, dates, source data, alternatives and fictional assumptions", () => {
    const d = draftOf(withDraft(delayed(), C), C);
    expect(d.format).toBe("brief");
    const b = d.body;
    expect(b).toContain("# Bank meeting brief");
    expect(b).toContain("lowest daily closing balance of **-3,000.00 RON** on 2026-11-10");
    expect(b).toContain("- First negative daily closing balance: 2026-11-10");
    expect(b).toContain("- Back at or above 0 RON: 2026-11-18");
    expect(b).toContain("| Disbursement | 2026-11-09 | 3,500.00 RON |");
    expect(b).toContain("| One-time fee | 2026-11-09 | 100.00 RON |");
    expect(b).toContain("| Principal repayment | 2026-11-20 | 3,500.00 RON |");
    expect(b).toContain("**400.00 RON**");
    expect(b).toContain("**6,900.00 RON**");
    expect(b).toMatch(/\| 2026-11-10 \| .* \| outflow \| 8,000\.00 RON \| SUP-001 \|/);
    expect(b).toMatch(/\| 2026-11-18 \| .* \| inflow \| 10,000\.00 RON \| CAT-001 \|/);
    expect(b).toContain("Forecast sales (10 events) | inflow | 8,000.00 RON");
    expect(b).toContain("## Alternatives considered");
    expect(b).toContain("- A. Partial collection: lowest daily closing balance 1,000.00 RON");
    expect(b).toContain("- B. Supplier deferral: lowest daily closing balance 1,000.00 RON");
    expect(b).toMatch(/Fictional financing product for this demo\. Not a real bank offer/);
    expect(b).toContain("not a loan application");
    expect(b).toContain("data revision 1");
  });

  it("the brief converts to plain text without Markdown syntax", () => {
    const text = markdownToPlainText(draftOf(withDraft(delayed(), C), C).body);
    expect(text).not.toMatch(/\*\*|^#|\| --- \|/m);
    expect(text).toContain("BANK MEETING BRIEF");
    expect(text).toContain("Disbursement  |  2026-11-09  |  3,500.00 RON");
  });
});

describe("simulated acceptance", () => {
  it("updates the active forecast exactly once and keeps baseline, actual cash and the receivable unchanged", () => {
    const before = withDraft(delayed(), A);
    const baselineBefore = before.baseline;
    expect(active(before).minimumClosingBalance).toBe(-300_000);

    const after = accept(before, A);
    const f = activeForecastOf(after)!;
    expect(f.result.minimumClosingBalance).toBe(100_000);
    expect(f.result.endingBalance).toBe(700_000);
    // Baseline and actual (opening) cash untouched.
    expect(after.baseline).toBe(baselineBefore);
    expect(calculateDatasetCashFlow(after.baseline, DEMO_TODAY).minimumClosingBalance).toBe(
      700_000,
    );
    expect(f.result.openingBalance).toBe(1_200_000);
    // Receivable stays open; every event is still a forecast; accepted parts are labelled.
    expect(f.view.receivables.find((r) => r.id === "rcv-cat-001")!.status).toBe("open");
    expect(after.baseline.receivables.find((r) => r.id === "rcv-cat-001")!.status).toBe("open");
    expect(f.view.cashEvents.every((e) => e.status === "forecast")).toBe(true);
    expect(f.view.cashEvents.filter((e) => e.layer === "accepted").map((e) => e.id)).toEqual([
      "evt-cat-001-part-1",
      "evt-cat-001-part-2",
    ]);
    // Audit trail.
    expect(after.acceptedChanges).toHaveLength(1);
    expect(after.acceptedChanges[0]).toMatchObject({
      id: `acc-${A}`,
      optionId: A,
      draftId: draftOf(before, A).id,
      acceptedAt: AT2,
      businessDate: DEMO_TODAY,
      sourceRevision: before.revision,
      draftRevision: draftOf(before, A).basis.revision,
      datasetVersion: "bucharest-cafe@1.0.0",
    });
    expect(draftOf(after, A).status).toBe("accepted");
    expect(draftOf(after, A).history.at(-1)).toEqual({
      event: "accepted",
      status: "accepted",
      at: AT2,
      businessDate: DEMO_TODAY,
      revision: before.revision,
    });
    expect(after.revision).toBe(before.revision + 1);
  });

  it("repeated acceptance is idempotent", () => {
    const once = accept(withDraft(delayed(), A), A);
    const twice = accept(once, A, "2026-10-28T13:00:00.000Z");
    expect(twice).toBe(once);
    expect(twice.acceptedChanges).toHaveLength(1);
    expect(active(twice).minimumClosingBalance).toBe(100_000);
    // Regenerating a draft for an accepted option is refused, so it cannot be accepted twice.
    expect(generateDraftFor(once, A, AT).ok).toBe(false);
  });

  it("works from Awaiting response; marking as awaiting does not change data", () => {
    const s = withDraft(delayed(), B);
    const awaiting = demoReducer(s, {
      type: "mark_draft_awaiting",
      draftId: draftOf(s, B).id,
      at: AT,
    });
    expect(draftOf(awaiting, B).status).toBe("awaiting_response");
    expect(draftOf(awaiting, B).history.at(-1)!.event).toBe("marked_awaiting");
    expect(awaiting.revision).toBe(s.revision);
    expect(active(awaiting)).toEqual(active(s));
    const accepted = accept(awaiting, B);
    expect(draftOf(accepted, B).status).toBe("accepted");
    expect(accepted.acceptedChanges.map((c) => c.optionId)).toEqual([B]);
  });

  it("an accepted option leaves the comparison; others are compared on the active case", () => {
    const s = accept(withDraft(delayed(), A), A);
    const c = recoveryComparisonOf(s)!;
    expect(c.delayScenario.id).toBe("scn-active-case");
    expect(c.delayed.minimumClosingBalance).toBe(100_000);
    const a = c.options.find((o) => o.terms.id === A)!;
    expect(a).toMatchObject({ available: false, accepted: true });
    const b = withDraft(s, B);
    // B's own proposal only touches SUP-001; the accepted CAT-001 split is not repeated.
    expect(draftOf(b, B).basis.proposal).toEqual([
      expect.objectContaining({ type: "split_event", eventId: "evt-sup-001" }),
    ]);
    const both = accept(b, B);
    expect(both.acceptedChanges.map((x) => x.optionId)).toEqual([A, B]);
    expect(
      activeForecastOf(both)!
        .view.cashEvents.filter((e) => e.layer === "accepted")
        .map((e) => e.id),
    ).toEqual(
      expect.arrayContaining(["evt-cat-001-part-1", "evt-sup-001-part-1", "evt-sup-001-part-2"]),
    );
  });
});

describe("simulated rejection", () => {
  it("does not change the forecast and excludes the option from further comparisons", () => {
    const before = withDraft(delayed(), B);
    const after = reject(before, B);
    expect(active(after)).toEqual(active(before));
    expect(after.acceptedChanges).toEqual([]);
    expect(draftOf(after, B).status).toBe("rejected");
    expect(draftOf(after, B).history.at(-1)).toMatchObject({ event: "rejected", at: AT2 });
    expect(after.rejectedOptions).toEqual([
      { optionId: B, reason: "Synthetic Coffee Supply SRL rejected the proposal (simulated)" },
    ]);
    expect(recoveryComparisonOf(after)!.options.find((o) => o.terms.id === B)).toMatchObject({
      available: false,
      rejected: true,
    });
    // Neither repeated rejection nor a later acceptance does anything.
    expect(reject(after, B)).toBe(after);
    expect(accept(after, B)).toBe(after);
  });

  it("the assistant reconsiders the remaining options after a rejection", () => {
    const state = reject(withDraft(delayed(), B), B);
    const created = createToolSession(structuredClone(snapshotFromState(state)));
    if (!created.ok) throw new Error(created.issues.join("; "));
    const ctx = createRunContext(created.session);
    const r = runTool(ctx, "compare_recovery_scenarios", { bufferRon: null });
    if (!r.ok) throw new Error(r.error.message);
    const data = r.data as {
      options: { id: string; available: boolean; rejectedByUser?: boolean }[];
      finding: { kind: string; passing?: string[] };
    };
    expect(data.options.find((o) => o.id === B)).toMatchObject({
      available: false,
      rejectedByUser: true,
    });
    expect(data.finding).toEqual({ kind: "options_meet_buffer", passing: [A, C] });
  });
});

describe("stale drafts", () => {
  it("a draft whose proposal no longer matches is blocked until regenerated", () => {
    const s = withDraft(delayed("2026-11-18"), A);
    const moved = delayed("2026-11-20", s);
    const stale = draftOf(moved, A);
    const f = freshnessOf(moved, stale);
    expect(f.kind).toBe("outdated");
    expect(responseCheck(moved, stale.id).ok).toBe(false);
    expect(accept(moved, A)).toBe(moved);
    expect(demoReducer(moved, { type: "mark_draft_awaiting", draftId: stale.id, at: AT })).toBe(
      moved,
    );

    const fresh = generateDraftFor(moved, A, AT2);
    if (!fresh.ok) throw new Error(fresh.reason);
    const regenerated = demoReducer(moved, {
      type: "upsert_action_draft",
      draft: regenerateDraft(stale, fresh.draft),
    });
    const d = draftOf(regenerated, A);
    expect(d.body).toContain("expected on 20 November 2026 (2026-11-20)");
    expect(d.history.map((h) => h.event)).toEqual(["generated", "regenerated"]);
    expect(freshnessOf(regenerated, d)).toEqual({ kind: "current", rechecked: false });
    expect(accept(regenerated, A).acceptedChanges).toHaveLength(1);
  });

  it("an unrelated data change only marks the draft as re-checked; acceptance stays allowed", () => {
    const s = withDraft(delayed(), A);
    const buffered = demoReducer(s, { type: "set_cash_buffer", amount: bani(50_000) });
    expect(freshnessOf(buffered, draftOf(buffered, A))).toEqual({
      kind: "current",
      rechecked: true,
    });
    expect(accept(buffered, A).acceptedChanges).toHaveLength(1);
  });

  it("a bank brief whose quoted figures changed is outdated, even though its proposal did not change", () => {
    const s = withDraft(withDraft(delayed(), A), C);
    expect(freshnessOf(s, draftOf(s, C)).kind).toBe("current");
    const after = accept(s, A); // the gap and the alternatives in the brief change
    const brief = draftOf(after, C);
    expect(freshnessOf(after, brief)).toMatchObject({ kind: "outdated" });
    expect(accept(after, C)).toBe(after);
    const fresh = generateDraftFor(after, C, AT2);
    if (!fresh.ok) throw new Error(fresh.reason);
    const regenerated = demoReducer(after, {
      type: "upsert_action_draft",
      draft: regenerateDraft(brief, fresh.draft),
    });
    const body = draftOf(regenerated, C).body;
    expect(body).toContain("lowest daily closing balance of **1,000.00 RON**");
    expect(body).toContain("- A. Partial collection: already accepted");
    expect(freshnessOf(regenerated, draftOf(regenerated, C)).kind).toBe("current");
  });

  it("a draft from another dataset version cannot be accepted", () => {
    const s = withDraft(delayed(), A);
    const d = draftOf(s, A);
    const foreign = demoReducer(s, {
      type: "upsert_action_draft",
      draft: { ...d, basis: { ...d.basis, datasetVersion: "csv-import@deadbeef" } },
    });
    expect(freshnessOf(foreign, draftOf(foreign, A)).kind).toBe("dataset_changed");
    expect(accept(foreign, A)).toBe(foreign);
  });

  it("replacing the dataset clears drafts and accepted changes", () => {
    const s = accept(withDraft(delayed(), A), A);
    const imported = demoReducer(s, {
      type: "replace_dataset",
      dataset: { ...s.baseline, datasetVersion: "csv-import@1" },
      source: { kind: "csv_import", fileName: "x.csv", rowCount: 14 },
    });
    expect(imported.actionDrafts).toEqual([]);
    expect(imported.acceptedChanges).toEqual([]);
    expect(demoReducer(s, { type: "reset" }).acceptedChanges).toEqual([]);
  });
});

describe("editing", () => {
  it("edits are allowed only while a draft is a draft, and are recorded", () => {
    const s = withDraft(delayed(), A);
    const id = draftOf(s, A).id;
    const edited = demoReducer(s, {
      type: "edit_action_draft",
      draftId: id,
      subject: "Quick request",
      body: "Hello",
      at: AT2,
    });
    expect(draftOf(edited, A)).toMatchObject({
      subject: "Quick request",
      body: "Hello",
      edited: true,
    });
    expect(draftOf(edited, A).history.at(-1)!.event).toBe("edited");
    expect(edited.revision).toBe(s.revision);
    // Text edits never change what acceptance applies.
    expect(draftOf(edited, A).basis).toEqual(draftOf(s, A).basis);
    const accepted = accept(edited, A);
    expect(
      demoReducer(accepted, {
        type: "edit_action_draft",
        draftId: id,
        subject: "x",
        body: "y",
        at: AT2,
      }),
    ).toBe(accepted);
  });
});

describe("assistant and drafts", () => {
  const session = (state: DemoState) => {
    const created = createToolSession(structuredClone(snapshotFromState(state)));
    if (!created.ok) throw new Error(created.issues.join("; "));
    return createRunContext(created.session);
  };

  it("does not regenerate a draft that is awaiting a response or accepted", () => {
    const s = withDraft(delayed(), A);
    const awaiting = demoReducer(s, {
      type: "mark_draft_awaiting",
      draftId: draftOf(s, A).id,
      at: AT,
    });
    const r = runTool(session(awaiting), "prepare_action_draft", { optionId: A });
    expect(!r.ok && r.error.code).toBe("precondition_failed");
    const r2 = runTool(session(accept(awaiting, A)), "prepare_action_draft", { optionId: A });
    expect(!r2.ok && r2.error.code).toBe("precondition_failed");
  });

  it("the agent's draft is the same as the UI's and its active case includes accepted proposals", () => {
    const s = accept(withDraft(delayed(), A), A);
    const ctx = session(s);
    const f = runTool(ctx, "calculate_forecast", { view: "active_case", includeDailyRows: false });
    if (!f.ok) throw new Error(f.error.message);
    expect((f.data as { minimumClosingBalance: { bani: number } }).minimumClosingBalance.bani).toBe(
      100_000,
    );
    const d = runTool(ctx, "prepare_action_draft", { optionId: B });
    if (!d.ok) throw new Error(d.error.message);
    const agentDraft = ctx.session.state.actionDrafts.find((x) => x.optionId === B)!;
    const uiDraft = draftOf(withDraft(s, B), B);
    expect(agentDraft.body).toBe(uiDraft.body);
    expect(agentDraft.basis).toEqual(uiDraft.basis);
  });
});
