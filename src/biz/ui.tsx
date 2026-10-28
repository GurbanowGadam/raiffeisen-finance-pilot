import { useState, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, BellRing, CheckCircle2, Info, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, SCENARIOS, TODAY, type Alert, type DayRow, type Transaction } from "./model";
import { ron, shortDate, useBiz } from "./store";

export const inputCls =
  "h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

export function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card p-5 shadow-sm ${className}`}>{children}</div>;
}

export function Stat({ label, value, tone = "default", hint }: { label: string; value: string; tone?: "default" | "good" | "bad" | "warn"; hint?: string }) {
  const c = { default: "text-foreground", good: "text-income", bad: "text-expense", warn: "text-warning" }[tone];
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-2 font-mono text-xl font-semibold ${c}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export function ScenarioBar() {
  const { scenario, setScenario, month, setMonth } = useBiz();
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2">
      <select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value as typeof month)} className="h-8 rounded-md border border-input bg-card px-2 text-sm font-medium">
        <option value="2026-11">November 2026</option>
        <option value="2026-12">December 2026</option>
      </select>
      <span className="mx-1 text-xs text-muted-foreground">Scenario:</span>
      {SCENARIOS.map((s) => (
        <button
          key={s.id}
          onClick={() => setScenario(s.id)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${scenario === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
        >
          {s.label}
        </button>
      ))}
      {scenario !== "original" && <span className="ml-auto rounded bg-accent px-2 py-1 text-[11px] font-medium text-accent-foreground">What-if view — your real data is unchanged</span>}
    </div>
  );
}

export function ForecastChart({ rows, compare, height = 260 }: { rows: DayRow[]; compare?: DayRow[] | undefined; height?: number }) {
  const data = rows.map((r, i) => ({ day: Number(r.date.slice(8)), balance: r.closing, original: compare?.[i]?.closing }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="bal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--income)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--income)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
        <Tooltip formatter={(v: number, n) => [ron(v), n === "original" ? "Original" : "Balance"]} labelFormatter={(l) => `Day ${l}`} />
        <ReferenceLine y={0} stroke="var(--expense)" strokeDasharray="4 4" />
        {compare && <Area type="monotone" dataKey="original" stroke="var(--muted-foreground)" strokeDasharray="4 3" fill="none" />}
        <Area type="monotone" dataKey="balance" stroke="var(--income)" strokeWidth={2} fill="url(#bal)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function AlertList({ alerts, compact }: { alerts: Alert[]; compact?: boolean }) {
  return (
    <div className="space-y-2">
      {alerts.map((a) => {
        const Icon = a.level === "critical" ? AlertTriangle : a.level === "warning" ? BellRing : a.level === "info" ? CheckCircle2 : Info;
        const tone = a.level === "critical" ? "border-expense-border bg-expense-soft text-expense" : a.level === "warning" ? "border-warning/40 bg-warning/10 text-warning" : "border-income-border bg-income-soft text-income";
        return (
          <div key={a.id} className={`flex gap-3 rounded-lg border p-3 ${tone}`}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">{a.title}</p>
              {!compact && <p className="mt-0.5 text-xs text-muted-foreground">{a.detail}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SimBadge() {
  return <span className="rounded bg-warning/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">Simulated</span>;
}

export function TxForm({ initial, onClose }: { initial?: Partial<Transaction>; onClose: () => void }) {
  const { upsertTx, deleteTx } = useBiz();
  const [t, setT] = useState<Transaction>({
    id: initial?.id ?? `tx-${Date.now().toString(36)}`,
    date: initial?.date ?? TODAY,
    type: initial?.type ?? "expense",
    category: initial?.category ?? (initial?.type === "income" ? "Sales" : "Other"),
    description: initial?.description ?? "",
    amount: initial?.amount ?? 0,
    status: initial?.status ?? "expected",
    recurrence: initial?.recurrence ?? "none",
  });
  const isEdit = !!initial?.id;
  const cats = t.type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const valid = t.description.trim() && t.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date);
  const f = (p: Partial<Transaction>) => setT((x) => ({ ...x, ...p }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Transaction">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Edit transaction" : "Add transaction"}</h2>
          <button onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {(["income", "expense"] as const).map((ty) => (
            <button key={ty} onClick={() => f({ type: ty, category: ty === "income" ? "Sales" : "Other" })}
              className={`rounded-md border py-2 text-sm font-semibold ${t.type === ty ? (ty === "income" ? "border-income bg-income-soft text-income" : "border-expense bg-expense-soft text-expense") : "border-border text-muted-foreground"}`}>
              {ty === "income" ? "+ Income" : "− Expense"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-2">Description<input className={inputCls} value={t.description} onChange={(e) => f({ description: e.target.value })} /></label>
          <label>Amount (RON)<input type="number" min={0} className={inputCls} value={t.amount || ""} onChange={(e) => f({ amount: Number(e.target.value) })} /></label>
          <label>Date<input type="date" className={inputCls} value={t.date} onChange={(e) => f({ date: e.target.value })} /></label>
          <label>Category<select className={inputCls} value={t.category} onChange={(e) => f({ category: e.target.value })}>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Repeats<select className={inputCls} value={t.recurrence} onChange={(e) => f({ recurrence: e.target.value as Transaction["recurrence"] })}>
            <option value="none">One-off</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={t.status === "done"} onChange={(e) => f({ status: e.target.checked ? "done" : "expected" })} />
            Mark as {t.type === "income" ? "received" : "paid"}
          </label>
        </div>
        <div className="mt-6 flex justify-between gap-2">
          {isEdit ? <Button variant="ghost" className="text-expense" onClick={() => { deleteTx(t.id); onClose(); }}>Delete</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={!valid} onClick={() => { upsertTx({ ...t, amount: Math.round(t.amount * 100) / 100 }); onClose(); }}>Save</Button>
          </div>
        </div>
        {initial?.recurrence && initial.recurrence !== "none" && isEdit && <p className="mt-3 text-xs text-muted-foreground">Editing a repeating item changes every occurrence.</p>}
      </div>
    </div>
  );
}

export function Amount({ type, amount }: { type: "income" | "expense"; amount: number }) {
  return <span className={`font-mono font-semibold ${type === "income" ? "text-income" : "text-expense"}`}>{type === "income" ? "+" : "−"}{ron(amount)}</span>;
}

export { shortDate };
