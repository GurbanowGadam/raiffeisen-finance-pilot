/**
 * Raiffeisen Business AI — pure financial model.
 * No React, no storage. Every number on screen comes from these functions.
 */

export const COMPANY = "Bucharest Coffee SRL";
export const OPENING_BALANCE = 12000;
/** Fixed demo clock so the forecast is reproducible. */
export const TODAY = "2026-11-01";
export const MONTHS = ["2026-11", "2026-12"] as const;
export type MonthKey = (typeof MONTHS)[number];
export const WARNING_CUSHION = 3000;

export type TxType = "income" | "expense";
export type Recurrence = "none" | "daily" | "weekly" | "monthly";
export type TxStatus = "expected" | "done";

export const INCOME_CATEGORIES = ["Sales", "Customer payment", "Other income"];
export const EXPENSE_CATEGORIES = [
  "Salaries",
  "Rent",
  "Suppliers",
  "Coffee",
  "Milk",
  "Syrups",
  "Cups & packaging",
  "Utilities",
  "Supplies",
  "Marketing",
  "Other",
];
/** Categories the owner can usually cut or postpone. */
export const NON_ESSENTIAL = ["Syrups", "Supplies", "Marketing", "Other", "Cups & packaging"];

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD (first occurrence for recurring)
  type: TxType;
  category: string;
  description: string;
  amount: number; // RON, positive
  status: TxStatus;
  recurrence: Recurrence;
}

export interface Occurrence extends Transaction {
  seriesId: string;
  occurrenceDate: string;
}

export interface DayRow {
  date: string;
  opening: number;
  income: number;
  expenses: number;
  closing: number;
  risk: "healthy" | "warning" | "critical";
  items: Occurrence[];
}

// ---------- dates ----------
export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysInMonth(month: string): number {
  const [y = 2026, m = 1] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function monthEnd(month: string) {
  return `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- seed ----------
export function seedTransactions(): Transaction[] {
  const t = (
    id: string,
    date: string,
    type: TxType,
    category: string,
    description: string,
    amount: number,
    recurrence: Recurrence = "none",
  ): Transaction => ({ id, date, type, category, description, amount, status: "expected", recurrence });
  return [
    t("rev", "2026-11-01", "income", "Sales", "Daily coffee shop revenue", 1300, "daily"),
    t("school", "2026-11-15", "income", "Customer payment", "Scoala Primara 12 — catering invoice", 10000, "monthly"),
    t("salaries", "2026-11-05", "expense", "Salaries", "Employee salaries", 15000, "monthly"),
    t("rent", "2026-11-05", "expense", "Rent", "Shop rent — Calea Victoriei", 4000, "monthly"),
    t("supplier", "2026-11-06", "expense", "Suppliers", "Main supplier — Lavazza distributor", 3000, "monthly"),
    t("beans", "2026-11-03", "expense", "Coffee", "Specialty coffee beans", 2500, "monthly"),
    t("beans2", "2026-11-17", "expense", "Coffee", "Specialty coffee beans (2nd order)", 2500, "monthly"),
    t("milk", "2026-11-02", "expense", "Milk", "Fresh milk delivery", 450, "weekly"),
    t("syrups", "2026-11-10", "expense", "Syrups", "Flavour syrups", 600, "monthly"),
    t("cups", "2026-11-08", "expense", "Cups & packaging", "Cups, lids & sleeves", 900, "monthly"),
    t("utilities", "2026-11-20", "expense", "Utilities", "Electricity, water & internet", 1400, "monthly"),
    t("supplies", "2026-11-12", "expense", "Supplies", "Cleaning & other supplies", 500, "monthly"),
    t("marketing", "2026-11-07", "expense", "Marketing", "Instagram promotion", 700, "monthly"),
  ];
}

// ---------- expansion & forecast ----------
export function expand(txs: Transaction[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const tx of txs) {
    if (tx.recurrence === "none") {
      if (tx.date >= from && tx.date <= to) out.push({ ...tx, seriesId: tx.id, occurrenceDate: tx.date });
      continue;
    }
    let d = tx.date;
    let i = 0;
    const day = Number(tx.date.slice(8, 10));
    while (d <= to && i < 1000) {
      if (d >= from) out.push({ ...tx, seriesId: tx.id, occurrenceDate: d, id: `${tx.id}@${d}` });
      i++;
      if (tx.recurrence === "daily") d = addDays(tx.date, i);
      else if (tx.recurrence === "weekly") d = addDays(tx.date, i * 7);
      else {
        const [y = 2026, m = 1] = tx.date.split("-").map(Number);
        const nm = new Date(Date.UTC(y, m - 1 + i, 1));
        const key = nm.toISOString().slice(0, 7);
        d = `${key}-${String(Math.min(day, daysInMonth(key))).padStart(2, "0")}`;
      }
    }
  }
  return out;
}

/** The single daily-balance function used by every screen. */
export function calculateDailyBalances(
  txs: Transaction[],
  month: string,
  opening = OPENING_BALANCE,
  start = TODAY,
): DayRow[] {
  const end = monthEnd(month);
  const occ = expand(txs, start, end);
  const rows: DayRow[] = [];
  let bal = opening;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const items = occ.filter((o) => o.occurrenceDate === d);
    const income = round2(items.filter((i) => i.type === "income").reduce((s, i) => s + i.amount, 0));
    const expenses = round2(items.filter((i) => i.type === "expense").reduce((s, i) => s + i.amount, 0));
    const closing = round2(bal + income - expenses);
    rows.push({
      date: d,
      opening: bal,
      income,
      expenses,
      closing,
      risk: closing < 0 ? "critical" : closing < WARNING_CUSHION ? "warning" : "healthy",
      items,
    });
    bal = closing;
  }
  return rows.filter((r) => r.date.startsWith(month));
}

export interface Summary {
  currentBalance: number;
  income: number;
  expenses: number;
  monthEnd: number;
  lowest: number;
  lowestDate: string;
  shortage: number;
  firstNegative: string | null;
  negativeDays: number;
}

export function summarize(rows: DayRow[]): Summary {
  let low = rows[0]!;
  for (const r of rows) if (r.closing < low.closing) low = r;
  const neg = rows.filter((r) => r.closing < 0);
  return {
    currentBalance: rows[0]?.opening ?? 0,
    income: round2(rows.reduce((s, r) => s + r.income, 0)),
    expenses: round2(rows.reduce((s, r) => s + r.expenses, 0)),
    monthEnd: rows[rows.length - 1]?.closing ?? 0,
    lowest: low?.closing ?? 0,
    lowestDate: low?.date ?? "",
    shortage: low && low.closing < 0 ? round2(-low.closing) : 0,
    firstNegative: neg[0]?.date ?? null,
    negativeDays: neg.length,
  };
}

// ---------- solutions / scenarios ----------
export interface SolutionSettings {
  earlyDate: string;
  loanAmount: number;
  loanRate: number; // illustrative annual %
  loanDays: number;
  loanStart: string;
  supplierId: string;
  supplierDate: string;
  cutIds: string[];
  cutPct: number; // 0-100; 100 = postpone to next month
}

export function defaultSolutions(): SolutionSettings {
  return {
    earlyDate: "2026-11-04",
    loanAmount: 5000,
    loanRate: 1.5,
    loanDays: 10,
    loanStart: "2026-11-05",
    supplierId: "supplier",
    supplierDate: "2026-11-16",
    cutIds: ["marketing", "syrups", "supplies"],
    cutPct: 100,
  };
}

export type ScenarioId = "original" | "early" | "financing" | "supplier" | "reduce" | "combined";
export const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: "original", label: "Original forecast" },
  { id: "early", label: "Early customer payment" },
  { id: "financing", label: "Hypothetical bank financing" },
  { id: "supplier", label: "Supplier payment extension" },
  { id: "reduce", label: "Reduce expenses" },
  { id: "combined", label: "Combined solution" },
];

export function loanCost(s: Pick<SolutionSettings, "loanAmount" | "loanRate" | "loanDays">) {
  const interest = round2((s.loanAmount * (s.loanRate / 100) * s.loanDays) / 365);
  return { interest, total: round2(s.loanAmount + interest) };
}

/** Find the biggest customer payment (the "school" invoice by default). */
export function mainCustomerPayment(txs: Transaction[]) {
  return [...txs].filter((t) => t.category === "Customer payment").sort((a, b) => b.amount - a.amount)[0];
}

/**
 * Moving a recurring item only moves the occurrence in the first month:
 * we split it into a one-off moved copy + the series starting next month.
 */
function moveFirstOccurrence(txs: Transaction[], id: string, newDate: string): Transaction[] {
  const tx = txs.find((t) => t.id === id);
  if (!tx) return txs;
  const rest = txs.filter((t) => t.id !== id);
  const moved: Transaction = { ...tx, id: `${id}~moved`, date: newDate, recurrence: "none" };
  if (tx.recurrence === "none") return [...rest, moved];
  const [next] = expand([tx], addDays(tx.date, 1), "2099-12-31").slice(0, 1);
  return next ? [...rest, moved, { ...tx, date: next.occurrenceDate }] : [...rest, moved];
}

export function applyScenario(txs: Transaction[], id: ScenarioId, s: SolutionSettings): Transaction[] {
  let out = txs;
  const use = (x: ScenarioId) => id === x || id === "combined";
  if (use("early")) {
    const main = mainCustomerPayment(out);
    if (main) out = moveFirstOccurrence(out, main.id, s.earlyDate);
  }
  if (use("supplier") && s.supplierId) out = moveFirstOccurrence(out, s.supplierId, s.supplierDate);
  if (id === "reduce") {
    for (const cid of s.cutIds) {
      const tx = out.find((t) => t.id === cid);
      if (!tx) continue;
      if (s.cutPct >= 100) {
        const firstMonth = tx.date.slice(0, 7);
        out = moveFirstOccurrence(out, cid, `${firstMonth === "2026-11" ? "2026-12" : firstMonth}-01`);
      } else out = out.map((t) => (t.id === cid ? { ...t, amount: round2(t.amount * (1 - s.cutPct / 100)) } : t));
    }
  }
  if (use("financing") && s.loanAmount > 0) {
    const { total } = loanCost(s);
    out = [
      ...out,
      { id: "loan-in", date: s.loanStart, type: "income", category: "Other income", description: "Hypothetical bank financing (simulated)", amount: s.loanAmount, status: "expected", recurrence: "none" },
      { id: "loan-out", date: addDays(s.loanStart, s.loanDays), type: "expense", category: "Other", description: "Financing repayment incl. interest (simulated)", amount: total, status: "expected", recurrence: "none" },
    ];
  }
  return out;
}

export function scenarioCost(id: ScenarioId, s: SolutionSettings) {
  return id === "financing" || id === "combined" ? loanCost(s).interest : 0;
}

// ---------- AI agent (rule-based, uses real calculations) ----------
export interface Alert {
  id: string;
  level: "critical" | "warning" | "info";
  title: string;
  detail: string;
}

const fmt = (n: number) => `${Math.round(n).toLocaleString("en-US")} RON`;
const dayName = (d: string) => `${Number(d.slice(8))} ${new Date(d + "T00:00:00Z").toLocaleString("en-US", { month: "short", timeZone: "UTC" })}`;

export function detectAlerts(txs: Transaction[], rows: DayRow[]): Alert[] {
  const s = summarize(rows);
  const alerts: Alert[] = [];
  if (s.firstNegative) {
    const neg = rows.find((r) => r.date === s.firstNegative)!;
    const big = neg.items.filter((i) => i.type === "expense").sort((a, b) => b.amount - a.amount);
    alerts.push({
      id: "negative",
      level: "critical",
      title: `Your projected balance may become negative on ${dayName(s.firstNegative)}.`,
      detail: `Payments due that day total ${fmt(neg.expenses)} (${big.slice(0, 3).map((b) => b.description).join(", ")}). Lowest point: ${fmt(s.lowest)} on ${dayName(s.lowestDate)} — you may need about ${fmt(s.shortage)} extra.`,
    });
    const sal = neg.items.find((i) => i.category === "Salaries");
    if (sal && neg.opening + neg.income < neg.expenses)
      alerts.push({ id: "salary", level: "critical", title: "Your salary payments may exceed your available funds.", detail: `Salaries of ${fmt(sal.amount)} are due ${dayName(neg.date)} while only ${fmt(neg.opening + neg.income)} is available that day.` });
  } else if (s.lowest < WARNING_CUSHION) {
    alerts.push({ id: "low", level: "warning", title: `Your balance drops to ${fmt(s.lowest)} on ${dayName(s.lowestDate)}.`, detail: `That is below the ${fmt(WARNING_CUSHION)} safety cushion. A small delay could push you below zero.` });
  }
  const main = mainCustomerPayment(txs);
  if (main) {
    const occ = rows.flatMap((r) => r.items).find((i) => i.seriesId === main.id || i.seriesId === `${main.id}~moved`);
    const bigExp = rows.flatMap((r) => r.items).filter((i) => i.type === "expense" && i.amount >= 3000);
    if (occ && bigExp.length && bigExp.every((e) => e.occurrenceDate < occ.occurrenceDate))
      alerts.push({ id: "timing", level: "warning", title: "Your largest customer payment is expected after your major expenses.", detail: `${main.description} (${fmt(main.amount)}) arrives ${dayName(occ.occurrenceDate)}, after ${bigExp.length} large payments.` });
    if (occ && !s.firstNegative) {
      const delayed = calculateDailyBalances(moveFirstOccurrence(txs, main.id, addDays(occ.occurrenceDate, 14)), rows[0]!.date.slice(0, 7));
      const ds = summarize(delayed);
      if (ds.firstNegative) alerts.push({ id: "delay", level: "warning", title: "A 14-day delay of your biggest customer payment would cause a shortage.", detail: `Balance would fall to ${fmt(ds.lowest)} on ${dayName(ds.lowestDate)}.` });
    }
  }
  if (!alerts.length) alerts.push({ id: "ok", level: "info", title: "No cash-flow problems detected this month.", detail: `Lowest balance ${fmt(s.lowest)} on ${dayName(s.lowestDate)}; month ends at ${fmt(s.monthEnd)}.` });
  return alerts;
}

export function agentSummary(txs: Transaction[], rows: DayRow[]): string {
  const s = summarize(rows);
  if (!s.firstNegative)
    return `I forecast every day of the month. Your balance stays positive — the lowest point is ${fmt(s.lowest)} on ${dayName(s.lowestDate)} and you should end the month with ${fmt(s.monthEnd)}.`;
  const before = rows.filter((r) => r.date <= s.lowestDate).flatMap((r) => r.items).filter((i) => i.type === "expense" && i.amount >= 2000);
  const cats = [...new Set(before.map((b) => b.category.toLowerCase()))].join(", ");
  const main = mainCustomerPayment(txs);
  const mainOcc = main && rows.flatMap((r) => r.items).find((i) => i.seriesId.startsWith(main.id) && i.type === "income");
  return `Your business may experience a cash shortage from ${dayName(s.firstNegative)}${mainOcc && mainOcc.occurrenceDate > s.firstNegative ? `, before the ${dayName(mainOcc.occurrenceDate)} ${main!.description.split("—")[0]!.trim()} payment` : ""}, because ${cats} are due first. The lowest projected balance is ${fmt(s.lowest)} on ${dayName(s.lowestDate)}, so you may need about ${fmt(s.shortage)} in additional funds to cover ${s.negativeDays} day(s).`;
}

export function agentAnswer(question: string, txs: Transaction[], rows: DayRow[], sol: SolutionSettings): string {
  const q = question.toLowerCase();
  const s = summarize(rows);
  const main = mainCustomerPayment(txs);
  if (/(run out|negative|shortage|when)/.test(q) && !/pay|arriv/.test(q)) return agentSummary(txs, rows);
  if (/(lowest|minimum|worst)/.test(q)) return `The lowest projected balance is ${fmt(s.lowest)} on ${dayName(s.lowestDate)}.`;
  if (/(how much|need|extra|borrow)/.test(q))
    return s.shortage > 0 ? `You need about ${fmt(s.shortage)} to stay at zero, or ${fmt(s.shortage + WARNING_CUSHION)} to keep a ${fmt(WARNING_CUSHION)} cushion.` : "You don't need extra money this month based on the current forecast.";
  if (/(cause|why|which expense|problem)/.test(q)) {
    const items = rows.filter((r) => r.date <= (s.lowestDate || "")).flatMap((r) => r.items).filter((i) => i.type === "expense").sort((a, b) => b.amount - a.amount).slice(0, 4);
    return `The biggest payments before your lowest point are: ${items.map((i) => `${i.description} ${fmt(i.amount)} (${dayName(i.occurrenceDate)})`).join("; ")}.`;
  }
  if (/(customer|payment arriv|school|income|arrive)/.test(q)) {
    const inc = rows.flatMap((r) => r.items).filter((i) => i.type === "income" && i.category !== "Sales");
    return inc.length ? `Expected customer payments: ${inc.map((i) => `${i.description} ${fmt(i.amount)} on ${dayName(i.occurrenceDate)}`).join("; ")}. Daily sales add about ${fmt(rows.flatMap((r) => r.items).find((i) => i.category === "Sales")?.amount ?? 0)} per day.` : "No customer payments are expected this month.";
  }
  if (/(delay|late)/.test(q) && main) {
    const occ = rows.flatMap((r) => r.items).find((i) => i.seriesId.startsWith(main.id));
    if (!occ) return "Your main customer payment is not in this month.";
    const ds = summarize(calculateDailyBalances(moveFirstOccurrence(txs, main.id, addDays(occ.occurrenceDate, 14)), rows[0]!.date.slice(0, 7)));
    return `If ${main.description} arrived 14 days late, your lowest balance would be ${fmt(ds.lowest)} on ${dayName(ds.lowestDate)}${ds.firstNegative ? ` and you'd go negative from ${dayName(ds.firstNegative)}` : " — still positive"}.`;
  }
  if (/(solution|fix|recommend|advice|what should|loan|financ)/.test(q)) {
    const res = SCENARIOS.filter((x) => x.id !== "original").map((x) => ({ x, sum: summarize(calculateDailyBalances(applyScenario(txs, x.id, sol), rows[0]!.date.slice(0, 7))) }));
    return `I compared the options: ${res.map((r) => `${r.x.label} → lowest ${fmt(r.sum.lowest)}${r.sum.shortage ? ` (still short ${fmt(r.sum.shortage)})` : " (no shortage)"}`).join("; ")}. Open Solutions to adjust them.`;
  }
  if (/(month end|end of month|finish)/.test(q)) return `You should end the month with ${fmt(s.monthEnd)}. Income ${fmt(s.income)}, expenses ${fmt(s.expenses)}.`;
  return `${agentSummary(txs, rows)} You can ask me: when will I run out of money, how much do I need, what causes the problem, when do customers pay, what if a payment is delayed, or what should I do.`;
}

export function earlyPaymentEmail(txs: Transaction[], earlyDate: string) {
  const main = mainCustomerPayment(txs);
  const who = main?.description.split("—")[0]!.trim() ?? "Customer";
  return `Subject: Request for early payment — invoice of ${fmt(main?.amount ?? 0)}

Dear ${who} team,

Thank you for our continued partnership. Bucharest Coffee SRL has an invoice of ${fmt(main?.amount ?? 0)} due on ${main ? dayName(main.date) : "the due date"}.

To help us manage a temporary timing difference in our monthly payments, we would be very grateful if you could settle this invoice earlier, ideally by ${dayName(earlyDate)}. If a full early payment is not possible, a partial payment would also help us greatly.

Our service and delivery schedule remain unchanged. Please let me know if you need any documents from us.

Kind regards,
Administrator
Bucharest Coffee SRL`;
}

// ---------- import ----------
export interface ImportResult {
  rows: Transaction[];
  errors: string[];
}

export function parseImportRows(raw: Record<string, unknown>[]): ImportResult {
  const errors: string[] = [];
  const rows: Transaction[] = [];
  raw.forEach((r, i) => {
    const g = (k: string) => {
      const key = Object.keys(r).find((x) => x.trim().toLowerCase() === k);
      return key ? r[key] : undefined;
    };
    const line = i + 2;
    let date = String(g("date") ?? "").trim();
    if (typeof g("date") === "number") {
      const d = new Date(Date.UTC(1899, 11, 30) + Number(g("date")) * 86400000);
      date = d.toISOString().slice(0, 10);
    }
    const type = String(g("type") ?? "").trim().toLowerCase();
    const amount = Number(String(g("amount") ?? "").replace(/[^0-9.\-]/g, ""));
    const description = String(g("description") ?? "").trim();
    const category = String(g("category") ?? "").trim() || (type === "income" ? "Other income" : "Other");
    const rec = String(g("recurrence") ?? "none").trim().toLowerCase() || "none";
    const status = String(g("status") ?? "expected").trim().toLowerCase();
    const errs: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errs.push("date must be YYYY-MM-DD");
    if (type !== "income" && type !== "expense") errs.push("type must be income or expense");
    if (!(amount > 0)) errs.push("amount must be a positive number");
    if (!description) errs.push("description is required");
    if (!["none", "daily", "weekly", "monthly"].includes(rec)) errs.push("recurrence must be none/daily/weekly/monthly");
    if (errs.length) errors.push(`Row ${line}: ${errs.join(", ")}`);
    else
      rows.push({
        id: `imp-${Date.now().toString(36)}-${i}`,
        date,
        type: type as TxType,
        category,
        description,
        amount: round2(amount),
        status: status === "done" || status === "paid" || status === "received" ? "done" : "expected",
        recurrence: rec as Recurrence,
      });
  });
  if (!raw.length) errors.push("The file has no rows.");
  return { rows, errors };
}

export const TEMPLATE_CSV = `date,type,category,description,amount,status,recurrence
2026-11-09,income,Customer payment,Office catering order,2500,expected,none
2026-11-11,expense,Supplies,New grinder maintenance,800,expected,none
2026-11-14,expense,Marketing,Flyers,300,expected,none
2026-11-21,income,Customer payment,Corporate event coffee bar,4200,expected,none
`;
