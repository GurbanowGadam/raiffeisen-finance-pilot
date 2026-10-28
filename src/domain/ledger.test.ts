import { describe, expect, it } from "vitest";
import { bucharestCafeAdapter } from "@/data/bucharest-cafe";
import { DEMO_TODAY, applyLedgerEdit, ledgerTotals, type Bani, type BusinessDate } from "@/domain";

const ds = bucharestCafeAdapter.loadBaseline();
const entry = {
  date: "2026-11-05" as BusinessDate,
  direction: "outflow" as const,
  amount: 12345 as Bani,
  category: "supplier" as const,
  description: "Coffee beans",
  counterparty: null,
};

describe("ledger edits", () => {
  it("adds a manual expense that reduces net flow by its amount", () => {
    const r = applyLedgerEdit(ds, { type: "add", id: "evt-user-1", entry }, DEMO_TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(ledgerTotals(r.dataset.cashEvents).net).toBe(ledgerTotals(ds.cashEvents).net - 12345);
  });
  it("rejects a zero amount", () => {
    const r = applyLedgerEdit(ds, { type: "add", id: "x1", entry: { ...entry, amount: 0 as Bani } }, DEMO_TODAY);
    expect(r.ok).toBe(false);
  });
  it("rejects dates outside the horizon", () => {
    const r = applyLedgerEdit(ds, { type: "add", id: "x2", entry: { ...entry, date: "2026-12-05" as BusinessDate } }, DEMO_TODAY);
    expect(r.ok).toBe(false);
  });
  it("editing an invoice payment keeps its invoice amount in sync", () => {
    const rec = ds.receivables[0]!;
    const ev = ds.cashEvents.find((e) => e.id === rec.cashEventId)!;
    const r = applyLedgerEdit(ds, { type: "update", id: ev.id, entry: { ...entry, direction: "inflow", category: ev.category, amount: 50000 as Bani } }, DEMO_TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dataset.receivables.find((x) => x.id === rec.id)!.amount).toBe(50000);
  });
  it("deleting an invoice payment also removes its invoice", () => {
    const rec = ds.receivables[0]!;
    const r = applyLedgerEdit(ds, { type: "remove", id: rec.cashEventId }, DEMO_TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dataset.receivables.some((x) => x.id === rec.id)).toBe(false);
  });
});
