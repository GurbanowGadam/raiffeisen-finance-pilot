/**
 * Manual ledger edits: add, update or remove a cash event in a dataset.
 *
 * Pure: returns a new, fully validated dataset or the list of problems. Linked
 * receivables follow their cash event (amount, date, counterparty) so the
 * one-invoice-one-event rule keeps holding; removing an event removes its invoice.
 */
import type { Bani } from "./types";
import type { BusinessDate } from "./types";
import { datasetIntegrityIssues } from "./integrity";
import {
  demoDatasetSchema,
  type CashCategory,
  type CashDirection,
  type CashEvent,
  type DemoDataset,
} from "./models";

export interface LedgerEntryInput {
  readonly date: BusinessDate;
  readonly direction: CashDirection;
  readonly amount: Bani;
  readonly category: CashCategory;
  readonly description: string;
  readonly counterparty: string | null;
}

export type LedgerEdit =
  | { readonly type: "add"; readonly id: string; readonly entry: LedgerEntryInput }
  | { readonly type: "update"; readonly id: string; readonly entry: LedgerEntryInput }
  | { readonly type: "remove"; readonly id: string };

export type LedgerEditResult =
  | { readonly ok: true; readonly dataset: DemoDataset }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface LedgerTotals {
  readonly income: Bani;
  readonly expenses: Bani;
  readonly net: Bani;
  readonly incomeCount: number;
  readonly expenseCount: number;
}

/** Sums inflows and outflows separately (integer bani). */
export function ledgerTotals(events: readonly CashEvent[]): LedgerTotals {
  let income = 0;
  let expenses = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  for (const e of events) {
    if (e.direction === "inflow") {
      income += e.amount;
      incomeCount += 1;
    } else {
      expenses += e.amount;
      expenseCount += 1;
    }
  }
  return {
    income: income as Bani,
    expenses: expenses as Bani,
    net: (income - expenses) as Bani,
    incomeCount,
    expenseCount,
  };
}

function nextVersion(version: string): string {
  const match = /^(.*)\+manual\.(\d+)$/.exec(version);
  return match ? `${match[1]}+manual.${Number(match[2]) + 1}` : `${version}+manual.1`;
}

export function applyLedgerEdit(
  dataset: DemoDataset,
  edit: LedgerEdit,
  today: BusinessDate,
): LedgerEditResult {
  const issues: string[] = [];
  if (edit.type !== "remove") {
    const e = edit.entry;
    if (!Number.isSafeInteger(e.amount) || e.amount <= 0) issues.push("Amount must be above 0");
    if (e.description.trim() === "") issues.push("Description is required");
    if (e.date < dataset.profile.horizon.start || e.date > dataset.profile.horizon.end) {
      issues.push(
        `Date must be between ${dataset.profile.horizon.start} and ${dataset.profile.horizon.end}`,
      );
    }
  }
  if (issues.length) return { ok: false, issues };

  let cashEvents = dataset.cashEvents.slice();
  let receivables = dataset.receivables.slice();
  const index = cashEvents.findIndex((e) => e.id === edit.id);

  if (edit.type === "add") {
    if (index !== -1) return { ok: false, issues: [`Event "${edit.id}" already exists`] };
    const e = edit.entry;
    cashEvents.push({
      id: edit.id,
      date: e.date,
      direction: e.direction,
      amount: e.amount,
      currency: dataset.profile.currency,
      category: e.category,
      description: e.description.trim(),
      counterparty: e.counterparty?.trim() || null,
      status: e.date <= today ? "actual" : "forecast",
      layer: "baseline",
      source: { kind: "user", id: edit.id, documentNumber: null },
    });
  } else {
    if (index === -1) return { ok: false, issues: [`Event "${edit.id}" not found`] };
    const current = cashEvents[index]!;
    if (edit.type === "remove") {
      cashEvents.splice(index, 1);
      receivables = receivables.filter((r) => r.cashEventId !== edit.id);
    } else {
      const e = edit.entry;
      const linked = receivables.find((r) => r.cashEventId === edit.id);
      if (linked && e.direction !== "inflow") {
        return { ok: false, issues: ["A customer invoice payment must stay income"] };
      }
      const { split: _split, ...rest } = current;
      const updated: CashEvent = {
        ...rest,
        date: e.date,
        direction: e.direction,
        amount: e.amount,
        category: e.category,
        description: e.description.trim(),
        counterparty: e.counterparty?.trim() || null,
        status: current.status === "actual" && e.date > today ? "forecast" : current.status,
        ...(current.split && e.amount === current.amount ? { split: current.split } : {}),
      };
      cashEvents[index] = updated;
      if (linked) {
        receivables = receivables.map((r) =>
          r.id === linked.id
            ? {
                ...r,
                amount: e.amount,
                expectedDate: e.date,
                counterparty: updated.counterparty ?? r.counterparty,
              }
            : r,
        );
      }
    }
  }

  cashEvents = cashEvents.sort((a, b) =>
    a.date === b.date ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.date < b.date ? -1 : 1,
  );

  const candidate = { ...dataset, datasetVersion: nextVersion(dataset.datasetVersion), cashEvents, receivables };
  const parsed = demoDatasetSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const integrity = datasetIntegrityIssues(parsed.data, today);
  if (integrity.length) return { ok: false, issues: integrity };
  return { ok: true, dataset: parsed.data };
}
