import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { shortDate, useBiz } from "@/biz/store";
import { Amount, Card, PageTitle, TxForm, inputCls } from "@/biz/ui";
import type { Transaction } from "@/biz/model";

export const Route = createFileRoute("/transactions")({
  head: () => ({
    meta: [
      { title: "Income & expenses — Raiffeisen Business AI" },
      { name: "description", content: "Add, edit and delete income and expenses, including recurring items." },
      { property: "og:title", content: "Income & expenses — Raiffeisen Business AI" },
      { property: "og:description", content: "Manage your SRL's income and expenses." },
    ],
  }),
  component: TxPage,
});

function TxPage() {
  const { transactions, upsertTx, deleteTx } = useBiz();
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Partial<Transaction> | null>(null);
  const list = transactions
    .filter((t) => filter === "all" || t.type === filter)
    .filter((t) => `${t.description} ${t.category}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      <PageTitle title="Income & expenses" sub="Every change instantly updates the calendar, dashboard and AI forecast."
        right={<div className="flex gap-2">
          <Button variant="outline" className="text-income" onClick={() => setEditing({ type: "income", category: "Sales" })}><Plus className="h-4 w-4" /> Income</Button>
          <Button onClick={() => setEditing({ type: "expense" })}><Plus className="h-4 w-4" /> Expense</Button></div>} />
      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", "income", "expense"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-3 py-1.5 text-sm capitalize ${filter === f ? "bg-primary font-semibold text-primary-foreground" : "bg-card text-muted-foreground"}`}>{f === "expense" ? "Expenses" : f}</button>
        ))}
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className={`${inputCls} ml-auto max-w-xs`} />
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground"><tr>
            <th className="p-3 text-left">Date</th><th className="p-3 text-left">Description</th><th className="p-3 text-left">Category</th><th className="p-3 text-left">Repeats</th><th className="p-3 text-left">Status</th><th className="p-3 text-right">Amount</th><th className="p-3" /></tr></thead>
          <tbody>{list.map((t) => (
            <tr key={t.id} className={`border-t border-border border-l-4 ${t.type === "income" ? "border-l-income" : "border-l-expense"}`}>
              <td className="p-3 whitespace-nowrap">{shortDate(t.date)}</td>
              <td className="p-3 font-medium">{t.description}</td>
              <td className="p-3"><span className={`rounded px-2 py-0.5 text-xs ${t.type === "income" ? "bg-income-soft text-income" : "bg-expense-soft text-expense"}`}>{t.category}</span></td>
              <td className="p-3 capitalize text-muted-foreground">{t.recurrence === "none" ? "One-off" : t.recurrence}</td>
              <td className="p-3">
                <button onClick={() => upsertTx({ ...t, status: t.status === "done" ? "expected" : "done" })}
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.status === "done" ? "bg-income-soft text-income" : "bg-muted text-muted-foreground"}`}>
                  {t.status === "done" ? (t.type === "income" ? "✓ Received" : "✓ Paid") : "Expected"}
                </button>
              </td>
              <td className="p-3 text-right whitespace-nowrap"><Amount type={t.type} amount={t.amount} /></td>
              <td className="p-3 whitespace-nowrap text-right">
                <button aria-label="Edit" className="p-1 text-muted-foreground hover:text-foreground" onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /></button>
                <button aria-label="Delete" className="p-1 text-muted-foreground hover:text-expense" onClick={() => deleteTx(t.id)}><Trash2 className="h-4 w-4" /></button>
              </td>
            </tr>))}
            {!list.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No transactions.</td></tr>}
          </tbody>
        </table>
      </Card>
      {editing && <TxForm initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
