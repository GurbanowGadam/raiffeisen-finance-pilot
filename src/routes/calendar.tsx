import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ron, shortDate, useBiz } from "@/biz/store";
import { Amount, Card, PageTitle, ScenarioBar, TxForm } from "@/biz/ui";
import type { Transaction } from "@/biz/model";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Cash-flow calendar — Raiffeisen Business AI" },
      { name: "description", content: "Every day of the month with income, expenses, closing balance and risk." },
      { property: "og:title", content: "Cash-flow calendar — Raiffeisen Business AI" },
      { property: "og:description", content: "Interactive monthly cash-flow calendar." },
    ],
  }),
  component: CalendarPage,
});

const riskCls = {
  healthy: "border-income-border bg-income-soft",
  warning: "border-warning/50 bg-warning/10",
  critical: "border-expense-border bg-expense-soft",
};

function CalendarPage() {
  const { rows, transactions } = useBiz();
  const [view, setView] = useState<"calendar" | "table">("calendar");
  const [selected, setSelected] = useState(rows[4]?.date ?? rows[0]?.date);
  const [editing, setEditing] = useState<Partial<Transaction> | null>(null);
  const sel = rows.find((r) => r.date === selected) ?? rows[0];
  const offset = (new Date(rows[0]!.date + "T00:00:00Z").getUTCDay() + 6) % 7;

  return (
    <>
      <PageTitle
        title="Monthly cash-flow calendar"
        sub="Green = healthy, orange = below 3,000 RON cushion, red = negative. Click a day for details."
        right={<div className="flex rounded-lg border border-border bg-card p-1">{(["calendar", "table"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 text-sm capitalize ${view === v ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground"}`}>{v === "table" ? "Daily table" : "Calendar"}</button>))}</div>}
      />
      <ScenarioBar />
      {view === "calendar" ? (
        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <div>
            <div className="mb-2 grid grid-cols-7 gap-2 text-center text-xs font-medium text-muted-foreground">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: offset }).map((_, i) => <div key={i} />)}
              {rows.map((r) => (
                <button key={r.date} onClick={() => setSelected(r.date)}
                  className={`min-h-24 rounded-lg border p-2 text-left text-[11px] transition hover:shadow ${riskCls[r.risk]} ${r.date === sel?.date ? "ring-2 ring-ring" : ""}`}>
                  <div className="text-sm font-bold">{Number(r.date.slice(8))}</div>
                  {r.income > 0 && <div className="text-income">+{Math.round(r.income).toLocaleString()}</div>}
                  {r.expenses > 0 && <div className="text-expense">−{Math.round(r.expenses).toLocaleString()}</div>}
                  <div className={`mt-1 font-mono font-semibold ${r.closing < 0 ? "text-expense" : ""}`}>{Math.round(r.closing).toLocaleString()}</div>
                </button>
              ))}
            </div>
          </div>
          {sel && (
            <Card className="h-fit">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{shortDate(sel.date)}</h2>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold capitalize ${sel.risk === "critical" ? "bg-expense-soft text-expense" : sel.risk === "warning" ? "bg-warning/10 text-warning" : "bg-income-soft text-income"}`}>{sel.risk}</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Opening</dt><dd className="text-right font-mono">{ron(sel.opening)}</dd>
                <dt className="text-muted-foreground">Closing</dt><dd className={`text-right font-mono font-semibold ${sel.closing < 0 ? "text-expense" : ""}`}>{ron(sel.closing)}</dd>
              </dl>
              <ul className="mt-4 divide-y divide-border">
                {sel.items.length === 0 && <li className="py-2 text-sm text-muted-foreground">Nothing scheduled.</li>}
                {sel.items.map((i) => {
                  const base = transactions.find((t) => t.id === i.seriesId);
                  return (
                    <li key={i.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <button className="text-left hover:underline disabled:no-underline" disabled={!base} onClick={() => base && setEditing(base)}>
                        <div className="font-medium">{i.description}</div>
                        <div className="text-xs text-muted-foreground">{i.category}{i.recurrence !== "none" ? ` · ${i.recurrence}` : ""}{i.status === "done" ? " · ✓" : ""}</div>
                      </button>
                      <Amount type={i.type} amount={i.amount} />
                    </li>
                  );
                })}
              </ul>
              <Button className="mt-3 w-full" onClick={() => setEditing({ date: sel.date })}><Plus className="h-4 w-4" /> Add on this day</Button>
            </Card>
          )}
        </div>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase text-muted-foreground"><tr>
              <th className="p-3 text-left">Date</th><th className="p-3 text-right">Opening</th><th className="p-3 text-right">Income</th><th className="p-3 text-right">Expenses</th><th className="p-3 text-right">Closing</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.date} className={`border-t border-border ${r.risk === "critical" ? "bg-expense-soft" : r.risk === "warning" ? "bg-warning/5" : ""}`}>
                <td className="p-3">{shortDate(r.date)}</td>
                <td className="p-3 text-right font-mono">{ron(r.opening)}</td>
                <td className="p-3 text-right font-mono text-income">{r.income ? `+${ron(r.income)}` : "—"}</td>
                <td className="p-3 text-right font-mono text-expense">{r.expenses ? `−${ron(r.expenses)}` : "—"}</td>
                <td className={`p-3 text-right font-mono font-semibold ${r.closing < 0 ? "text-expense" : ""}`}>{ron(r.closing)}</td>
              </tr>))}</tbody>
          </table>
        </Card>
      )}
      {editing && <TxForm initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
