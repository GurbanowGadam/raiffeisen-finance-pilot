/**
 * Delay simulator + solution finder + bank view. Pure and deterministic.
 *
 * - `simulateDelay` moves ANY cash event to a new date and recalculates.
 * - `findSolutions` builds independent fixes (bank overdraft, invoice financing,
 *   short-term loan, expense deferral), each recalculated on the same delayed basis,
 *   with the cost to the business.
 * - `bankProfile` scores credit readiness and sizes a pre-approved credit line.
 *
 * All rates are labelled demo assumptions (BANK_TERMS), never offers. Money is integer bani.
 */
import { calculateDailyCashFlow, type DailyCashFlowResult } from "./cash-flow";
import { addDays } from "./dates";
import type { CashEvent, DemoDataset } from "./models";
import { formatBani } from "./money";
import type { Bani, BusinessDate } from "./types";

export const BANK_TERMS = {
  /** Overdraft: annual interest (basis points) + arrangement fee (bps of limit). */
  overdraftAprBps: 1200,
  overdraftArrangementBps: 50,
  /** Invoice financing: advance share and flat fee (bps of advance). */
  invoiceAdvanceBps: 8000,
  invoiceFeeBps: 250,
  /** Short-term loan: origination fee (bps) and annual interest (bps), 90-day term. */
  loanOriginationBps: 150,
  loanAprBps: 1000,
  loanTermDays: 90,
  /** Deferral used when asking a supplier to wait. */
  deferralDays: 14,
} as const;

const ROUND = 10_000; // round financing to 100 RON

function roundUp(amount: number): Bani {
  return (Math.ceil(amount / ROUND) * ROUND) as Bani;
}
function bps(amount: number, rate: number): Bani {
  return Math.round((amount * rate) / 10_000) as Bani;
}
export function daysBetween(a: BusinessDate, b: BusinessDate): number {
  const t = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

function calc(dataset: DemoDataset, events: readonly CashEvent[]): DailyCashFlowResult {
  return calculateDailyCashFlow({
    currency: dataset.profile.currency,
    openingBalance: dataset.profile.openingBalance,
    horizon: dataset.profile.horizon,
    events: [...events],
  });
}

function makeEvent(
  dataset: DemoDataset,
  id: string,
  date: BusinessDate,
  direction: CashEvent["direction"],
  amount: Bani,
  category: CashEvent["category"],
  description: string,
  counterparty: string,
): CashEvent {
  return {
    id,
    date,
    direction,
    amount,
    currency: dataset.profile.currency,
    category,
    description,
    counterparty,
    status: "forecast",
    layer: "scenario",
    source: { kind: "scenario", id, documentNumber: null },
  };
}

// ---------------------------------------------------------------------------
// Delay
// ---------------------------------------------------------------------------

export interface DelaySimulation {
  readonly event: CashEvent;
  readonly newDate: BusinessDate;
  readonly events: readonly CashEvent[];
  readonly before: DailyCashFlowResult;
  readonly after: DailyCashFlowResult;
}

export function simulateDelay(
  dataset: DemoDataset,
  eventId: string,
  newDate: BusinessDate,
): { ok: true; sim: DelaySimulation } | { ok: false; error: string } {
  const event = dataset.cashEvents.find((e) => e.id === eventId);
  if (!event) return { ok: false, error: "Transaction not found" };
  if (newDate <= event.date) return { ok: false, error: "The new date must be later than the original date" };
  const events = dataset.cashEvents.map((e) =>
    e.id === eventId ? { ...e, date: newDate, layer: "scenario" as const } : e,
  );
  return {
    ok: true,
    sim: { event, newDate, events, before: calc(dataset, dataset.cashEvents), after: calc(dataset, events) },
  };
}

// ---------------------------------------------------------------------------
// Solutions
// ---------------------------------------------------------------------------

export type SolutionProvider = "bank" | "supplier";

export interface Solution {
  readonly id: "overdraft" | "invoice_financing" | "short_loan" | "defer_expense";
  readonly title: string;
  readonly provider: SolutionProvider;
  readonly summary: string;
  readonly steps: readonly string[];
  readonly events: readonly CashEvent[];
  readonly result: DailyCashFlowResult;
  /** True when no day closes below zero after the fix. */
  readonly solves: boolean;
  /** Fees and interest the business pays (bani). */
  readonly costToBusiness: Bani;
  readonly fundingAmount: Bani;
}

export function findSolutions(
  dataset: DemoDataset,
  sim: DelaySimulation,
  today: BusinessDate,
): Solution[] {
  const r = sim.after;
  if (r.firstNegativeClosingDate === null) return [];
  const gapDate = r.firstNegativeClosingDate;
  const need = roundUp(r.shortfall);
  const end = dataset.profile.horizon.end;
  const base = sim.events;
  const out: Solution[] = [];
  const push = (s: Omit<Solution, "result" | "solves">) => {
    const result = calc(dataset, s.events);
    out.push({ ...s, result, solves: result.firstNegativeClosingDate === null });
  };

  // 1. Overdraft: draw on the gap date, repay at horizon end with interest.
  {
    const draw = addDays(gapDate, -1) < today ? gapDate : addDays(gapDate, -1);
    const days = Math.max(1, daysBetween(draw, end));
    const interest = Math.round((need * BANK_TERMS.overdraftAprBps * days) / (10_000 * 365)) as Bani;
    const arrangement = bps(need, BANK_TERMS.overdraftArrangementBps);
    const fees = (interest + arrangement) as Bani;
    push({
      id: "overdraft",
      title: "Bank overdraft",
      provider: "bank",
      summary: `Draw ${formatBani(need)} on ${draw}, repay on ${end}.`,
      steps: [
        `Overdraft limit of ${formatBani(need)} activated the day before the gap`,
        `${days} days of interest at ${BANK_TERMS.overdraftAprBps / 100}% a year`,
        "Repaid in full at month end",
      ],
      events: [
        ...base,
        makeEvent(dataset, "sol-od-draw", draw, "inflow", need, "financing", "Overdraft drawdown", "Raiffeisen Bank (demo)"),
        makeEvent(dataset, "sol-od-repay", end, "outflow", (need + fees) as Bani, "financing", "Overdraft repayment + interest", "Raiffeisen Bank (demo)"),
      ],
      costToBusiness: fees,
      fundingAmount: need,
    });
  }

  // 2. Invoice financing: only when the delayed transaction is money coming in.
  if (sim.event.direction === "inflow" && sim.newDate !== sim.event.date) {
    const advance = bps(sim.event.amount, BANK_TERMS.invoiceAdvanceBps);
    const fee = bps(advance, BANK_TERMS.invoiceFeeBps);
    const advDate = sim.event.date < today ? today : sim.event.date;
    push({
      id: "invoice_financing",
      title: "Invoice financing",
      provider: "bank",
      summary: `Bank advances ${BANK_TERMS.invoiceAdvanceBps / 100}% of the late payment on its original date.`,
      steps: [
        `Advance ${formatBani(advance)} on ${advDate}`,
        `Flat fee ${BANK_TERMS.invoiceFeeBps / 100}% of the advance`,
        `Repaid automatically when the customer pays on ${sim.newDate}`,
      ],
      events: [
        ...base,
        makeEvent(dataset, "sol-if-adv", advDate, "inflow", advance, "financing", "Invoice financing advance", "Raiffeisen Bank (demo)"),
        makeEvent(dataset, "sol-if-repay", sim.newDate, "outflow", (advance + fee) as Bani, "financing", "Invoice financing settlement", "Raiffeisen Bank (demo)"),
      ],
      costToBusiness: fee,
      fundingAmount: advance,
    });
  }

  // 3. Short-term loan: 90 days, only the disbursement and fee fall in this month.
  {
    const principal = roundUp((Math.max(need, 100_000) * 10_000) / (10_000 - BANK_TERMS.loanOriginationBps));
    const orig = bps(principal, BANK_TERMS.loanOriginationBps);
    const interest = Math.round((principal * BANK_TERMS.loanAprBps * BANK_TERMS.loanTermDays) / (10_000 * 365)) as Bani;
    const disb = addDays(gapDate, -1) < today ? gapDate : addDays(gapDate, -1);
    push({
      id: "short_loan",
      title: "90-day business loan",
      provider: "bank",
      summary: `Borrow ${formatBani(principal)}, repay after ${BANK_TERMS.loanTermDays} days.`,
      steps: [
        `Disbursed on ${disb}`,
        `${BANK_TERMS.loanOriginationBps / 100}% origination fee paid upfront`,
        `Interest ${BANK_TERMS.loanAprBps / 100}% a year; repayment falls after this month`,
      ],
      events: [
        ...base,
        makeEvent(dataset, "sol-ln-disb", disb, "inflow", principal, "financing", "Business loan disbursement", "Raiffeisen Bank (demo)"),
        makeEvent(dataset, "sol-ln-fee", disb, "outflow", orig, "financing", "Loan origination fee", "Raiffeisen Bank (demo)"),
      ],
      costToBusiness: (orig + interest) as Bani,
      fundingAmount: principal,
    });
  }

  // 4. Defer the biggest expense due on or before the gap date.
  {
    const candidate = base
      .filter((e) => e.direction === "outflow" && e.date >= today && e.date <= gapDate && e.category !== "payroll" && e.category !== "tax")
      .sort((a, b) => b.amount - a.amount)[0];
    if (candidate) {
      const target = addDays(candidate.date, BANK_TERMS.deferralDays);
      const to = target > end ? end : target;
      push({
        id: "defer_expense",
        title: `Ask to delay: ${candidate.description}`,
        provider: "supplier",
        summary: `Move ${formatBani(candidate.amount)} from ${candidate.date} to ${to}.`,
        steps: [
          `Request a ${daysBetween(candidate.date, to)}-day extension from ${candidate.counterparty ?? "the supplier"}`,
          "No fee assumed; the supplier must agree",
        ],
        events: base.map((e) => (e.id === candidate.id ? { ...e, date: to, layer: "scenario" as const } : e)),
        costToBusiness: 0 as Bani,
        fundingAmount: 0 as Bani,
      });
    }
  }

  return out.sort((a, b) =>
    a.solves !== b.solves ? (a.solves ? -1 : 1) : a.costToBusiness - b.costToBusiness,
  );
}

// ---------------------------------------------------------------------------
// Bank view
// ---------------------------------------------------------------------------

export interface BankProfile {
  /** 0–100 credit readiness score. */
  readonly score: number;
  readonly grade: "A" | "B" | "C" | "D";
  readonly factors: readonly { label: string; points: number; max: number; note: string }[];
  readonly monthlyIncome: Bani;
  readonly monthlyExpenses: Bani;
  readonly negativeDays: number;
  /** Suggested pre-approved revolving limit. */
  readonly creditLine: Bani;
}

export function bankProfile(dataset: DemoDataset, result: DailyCashFlowResult): BankProfile {
  let income = 0;
  let expenses = 0;
  let largestIn = 0;
  for (const e of dataset.cashEvents) {
    if (e.direction === "inflow") {
      income += e.amount;
      largestIn = Math.max(largestIn, e.amount);
    } else expenses += e.amount;
  }
  const negativeDays = result.days.filter((d) => d.closingBalance < 0).length;
  const coverage = expenses === 0 ? 2 : income / expenses;
  const cushion = result.openingBalance <= 0 ? 0 : result.minimumClosingBalance / result.openingBalance;
  const concentration = income === 0 ? 1 : largestIn / income;

  const f1 = Math.round(Math.max(0, Math.min(1, coverage / 1.2)) * 35);
  const f2 = Math.round(Math.max(0, Math.min(1, cushion + 0.2)) * 30);
  const f3 = negativeDays === 0 ? 20 : Math.max(0, 20 - negativeDays * 2);
  const f4 = Math.round(Math.max(0, Math.min(1, (1 - concentration) / 0.7)) * 15);
  const score = f1 + f2 + f3 + f4;
  const grade = score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : "D";
  const share = grade === "A" ? 3000 : grade === "B" ? 2000 : grade === "C" ? 1000 : 0;
  const creditLine = roundUp(bps(income, share));

  return {
    score,
    grade,
    factors: [
      { label: "Income covers expenses", points: f1, max: 35, note: `${(coverage * 100).toFixed(0)}% coverage` },
      { label: "Cash cushion", points: f2, max: 30, note: "Lowest balance vs opening cash" },
      { label: "Days below zero", points: f3, max: 20, note: `${negativeDays} day${negativeDays === 1 ? "" : "s"}` },
      { label: "Customer diversity", points: f4, max: 15, note: `Largest payment ${(concentration * 100).toFixed(0)}% of income` },
    ],
    monthlyIncome: income as Bani,
    monthlyExpenses: expenses as Bani,
    negativeDays,
    creditLine,
  };
}

// ---------------------------------------------------------------------------
// Early warning: predict every day and advise before the balance goes negative
// ---------------------------------------------------------------------------

export type WarningLevel = "critical" | "warning" | "info";

export interface EarlyWarning {
  readonly level: WarningLevel;
  readonly title: string;
  readonly detail: string;
  readonly date: BusinessDate | null;
}

export interface PreventionPlan {
  readonly result: DailyCashFlowResult;
  readonly warnings: readonly EarlyWarning[];
  /** Fixes for the plan as it stands (no hypothetical delay); empty when no day goes negative. */
  readonly fixes: readonly Solution[];
  /** Days until the first negative close, or null. */
  readonly daysToGap: number | null;
  /** Safety threshold used for "low cash" warnings (10% of opening cash). */
  readonly cushion: Bani;
}

export function preventionPlan(dataset: DemoDataset, today: BusinessDate): PreventionPlan {
  const result = calc(dataset, dataset.cashEvents);
  const cushion = Math.max(0, Math.round(result.openingBalance / 10)) as Bani;
  const warnings: EarlyWarning[] = [];
  const gap = result.firstNegativeClosingDate;

  if (gap) {
    const negDays = result.days.filter((d) => d.closingBalance < 0).length;
    warnings.push({
      level: "critical",
      title: `Balance goes negative on ${gap}`,
      detail: `Short by up to ${formatBani(result.shortfall)} across ${negDays} day${negDays === 1 ? "" : "s"}. Act before ${addDays(gap, -1)}.`,
      date: gap,
    });
  }
  const low = result.days.filter((d) => d.closingBalance >= 0 && d.closingBalance < cushion);
  if (low.length > 0) {
    warnings.push({
      level: "warning",
      title: `${low.length} day${low.length === 1 ? "" : "s"} below the safety cushion`,
      detail: `Closing cash under ${formatBani(cushion)} (10% of opening cash) from ${low[0]!.date}. One surprise bill could push you negative.`,
      date: low[0]!.date,
    });
  }
  const outflows = dataset.cashEvents.filter((e) => e.direction === "outflow" && e.date >= today);
  const biggest = outflows.slice().sort((a, b) => b.amount - a.amount)[0];
  if (biggest) {
    const dayBefore = result.days.find((d) => d.date === biggest.date);
    warnings.push({
      level: dayBefore && dayBefore.closingBalance < cushion ? "warning" : "info",
      title: `Biggest payment: ${biggest.description}`,
      detail: `${formatBani(biggest.amount)} leaves on ${biggest.date}. Make sure incoming money lands first.`,
      date: biggest.date,
    });
  }
  const inflows = dataset.cashEvents.filter((e) => e.direction === "inflow");
  const totalIn = inflows.reduce((s, e) => s + e.amount, 0);
  const topIn = inflows.slice().sort((a, b) => b.amount - a.amount)[0];
  if (topIn && totalIn > 0 && topIn.amount * 100 >= totalIn * 40) {
    warnings.push({
      level: "warning",
      title: `${Math.round((topIn.amount * 100) / totalIn)}% of income depends on one payment`,
      detail: `${topIn.description}${topIn.counterparty ? ` from ${topIn.counterparty}` : ""}. If it is late, test it in the delay simulator and line up a backup.`,
      date: topIn.date,
    });
  }
  if (!gap && low.length === 0) {
    warnings.push({
      level: "info",
      title: "No negative days predicted",
      detail: `Lowest closing cash is ${formatBani(result.minimumClosingBalance)} on ${result.minimumClosingDate}.`,
      date: result.minimumClosingDate,
    });
  }

  const fixes = gap
    ? findSolutions(
        dataset,
        {
          event: dataset.cashEvents[0]!,
          newDate: dataset.cashEvents[0]!.date,
          events: dataset.cashEvents,
          before: result,
          after: result,
        },
        today,
      )
    : [];

  return {
    result,
    warnings,
    fixes,
    daysToGap: gap ? daysBetween(today, gap) : null,
    cushion,
  };
}
