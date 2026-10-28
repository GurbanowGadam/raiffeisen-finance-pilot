import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Copy, Mail, Landmark, Truck, Scissors } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  NON_ESSENTIAL, SCENARIOS, addDays, applyScenario, calculateDailyBalances, earlyPaymentEmail, loanCost,
  mainCustomerPayment, scenarioCost, summarize,
} from "@/biz/model";
import { ron, shortDate, useBiz } from "@/biz/store";
import { AlertList, Card, ForecastChart, PageTitle, SimBadge, inputCls } from "@/biz/ui";

export const Route = createFileRoute("/solutions")({
  head: () => ({
    meta: [
      { title: "Solutions & comparison — Raiffeisen Business AI" },
      { name: "description", content: "Early payment email, simulated financing, supplier delay and expense cuts compared side by side." },
      { property: "og:title", content: "Solutions — Raiffeisen Business AI" },
      { property: "og:description", content: "Compare cash-flow solutions for your SRL." },
    ],
  }),
  component: SolutionsPage,
});

function SolutionsPage() {
  const b = useBiz();
  const { transactions: tx, solutions: s, setSolutions, month, scenario, setScenario, originalRows, alerts } = b;
  const orig = summarize(originalRows);
  const main = mainCustomerPayment(tx);
  const [email, setEmail] = useState(() => earlyPaymentEmail(tx, s.earlyDate));
  const loan = loanCost(s);
  const expenses = tx.filter((t) => t.type === "expense");
  const suppliers = expenses.filter((t) => t.category === "Suppliers" || t.category === "Coffee" || t.category === "Milk");
  const cuttable = expenses.filter((t) => NON_ESSENTIAL.includes(t.category));

  const compare = useMemo(
    () => SCENARIOS.map((sc) => {
      const rows = calculateDailyBalances(applyScenario(tx, sc.id, s), month);
      return { ...sc, rows, sum: summarize(rows), cost: scenarioCost(sc.id, s) };
    }),
    [tx, s, month],
  );
  const active = compare.find((c) => c.id === scenario)!;

  return (
    <>
      <PageTitle title="Solutions" sub={orig.shortage ? `The AI found a potential shortage of ${ron(orig.shortage)} from ${shortDate(orig.firstNegative!)}. Here are four ways to prevent it.` : "No shortage right now — you can still explore what-ifs."} />
      {orig.shortage > 0 && <div className="mb-6"><AlertList alerts={alerts.filter((a) => a.level === "critical").slice(0, 1)} /></div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <Head icon={Mail} letter="A" title="Request early payment" />
          {main ? <>
            <div className="mb-3 flex items-center gap-2 text-sm">Ask {main.description.split("—")[0]} to pay by
              <input type="date" className={`${inputCls} w-40`} value={s.earlyDate} onChange={(e) => { setSolutions({ earlyDate: e.target.value }); setEmail(earlyPaymentEmail(tx, e.target.value)); }} />
            </div>
            <textarea className="h-56 w-full rounded-md border border-input bg-card p-3 font-mono text-xs" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button variant="outline" className="mt-2" onClick={() => { navigator.clipboard.writeText(email); toast.success("Email copied"); }}><Copy className="h-4 w-4" /> Copy email</Button>
          </> : <p className="text-sm text-muted-foreground">Add a "Customer payment" income first.</p>}
        </Card>

        <Card>
          <Head icon={Landmark} letter="B" title="Explore bank financing" badge />
          <p className="mb-3 text-xs text-muted-foreground">Hypothetical demo values — not actual Raiffeisen Bank terms.</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label>Amount (RON)<input type="number" className={inputCls} value={s.loanAmount} onChange={(e) => setSolutions({ loanAmount: Math.max(0, Number(e.target.value)) })} /></label>
            <label>Annual rate (%)<input type="number" step="0.1" className={inputCls} value={s.loanRate} onChange={(e) => setSolutions({ loanRate: Math.max(0, Number(e.target.value)) })} /></label>
            <label>Duration (days)<input type="number" className={inputCls} value={s.loanDays} onChange={(e) => setSolutions({ loanDays: Math.max(1, Number(e.target.value)) })} /></label>
            <label>Funds received<input type="date" className={inputCls} value={s.loanStart} onChange={(e) => setSolutions({ loanStart: e.target.value })} /></label>
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-muted p-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Est. interest</dt><dd className="font-mono font-semibold">{ron(loan.interest)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Total repayment</dt><dd className="font-mono font-semibold">{ron(loan.total)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Repay on</dt><dd className="font-semibold">{shortDate(addDays(s.loanStart, s.loanDays))}</dd></div>
          </dl>
          <Button className="mt-3" onClick={() => { b.submitRequest({
            company: "Bucharest Coffee SRL", amount: s.loanAmount, rate: s.loanRate, days: s.loanDays,
            reason: `Short-term gap: salaries, rent and supplier payments due before customer payment. AI forecast shortage ${ron(orig.shortage)} from ${orig.firstNegative ? shortDate(orig.firstNegative) : "n/a"}.`,
            expectedPaymentDate: main?.date ?? "",
          }); toast.success("Financing inquiry submitted to the simulated bank dashboard"); }}>Submit Financing Request</Button>
          {b.requests[0] && <p className="mt-2 text-xs">Latest request {b.requests[0].id}: <Link to="/bank" className="font-semibold underline">{b.requests[0].status}</Link> <SimBadge /></p>}
        </Card>

        <Card>
          <Head icon={Truck} letter="C" title="Delay a supplier payment" />
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label>Payment<select className={inputCls} value={s.supplierId} onChange={(e) => setSolutions({ supplierId: e.target.value })}>{suppliers.map((t) => <option key={t.id} value={t.id}>{t.description} ({ron(t.amount)})</option>)}</select></label>
            <label>New date<input type="date" className={inputCls} value={s.supplierDate} onChange={(e) => setSolutions({ supplierDate: e.target.value })} /></label>
          </div>
          <Result sum={compare.find((c) => c.id === "supplier")!.sum} />
        </Card>

        <Card>
          <Head icon={Scissors} letter="D" title="Reduce or postpone expenses" />
          <div className="space-y-1 text-sm">
            {cuttable.map((t) => (
              <label key={t.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><input type="checkbox" checked={s.cutIds.includes(t.id)} onChange={(e) => setSolutions({ cutIds: e.target.checked ? [...s.cutIds, t.id] : s.cutIds.filter((x) => x !== t.id) })} />{t.description}</span>
                <span className="font-mono text-expense">{ron(t.amount)}</span>
              </label>
            ))}
          </div>
          <label className="mt-3 block text-sm">Cut by {s.cutPct === 100 ? "100% (postpone to next month)" : `${s.cutPct}%`}
            <input type="range" min={10} max={100} step={10} value={s.cutPct} onChange={(e) => setSolutions({ cutPct: Number(e.target.value) })} className="w-full accent-[var(--primary)]" /></label>
          <Result sum={compare.find((c) => c.id === "reduce")!.sum} />
        </Card>
      </div>

      <h2 className="mb-3 mt-10 text-xl font-bold">Compare solutions</h2>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground"><tr><th className="p-3 text-left">Scenario</th><th className="p-3 text-right">Lowest balance</th><th className="p-3 text-right">Funding shortage</th><th className="p-3 text-right">Financing cost</th><th className="p-3 text-right">Month-end</th><th /></tr></thead>
          <tbody>{compare.map((c) => (
            <tr key={c.id} className={`border-t border-border ${scenario === c.id ? "bg-accent" : ""}`}>
              <td className="p-3 font-medium">{c.label}{(c.id === "financing" || c.id === "combined") && <> <SimBadge /></>}{c.id === "combined" && <span className="block text-xs font-normal text-muted-foreground">Early payment + financing + supplier extension</span>}</td>
              <td className={`p-3 text-right font-mono ${c.sum.lowest < 0 ? "text-expense" : "text-income"}`}>{ron(c.sum.lowest)}</td>
              <td className={`p-3 text-right font-mono ${c.sum.shortage ? "text-expense" : "text-income"}`}>{c.sum.shortage ? ron(c.sum.shortage) : "None"}</td>
              <td className="p-3 text-right font-mono">{ron(c.cost)}</td>
              <td className="p-3 text-right font-mono">{ron(c.sum.monthEnd)}</td>
              <td className="p-3 text-right"><Button size="sm" variant={scenario === c.id ? "default" : "outline"} onClick={() => setScenario(c.id)}>{scenario === c.id ? "Viewing" : "View"}</Button></td>
            </tr>))}</tbody>
        </table>
      </Card>
      <Card className="mt-6">
        <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">{active.label} vs original</h3><Link to="/calendar" className="text-xs font-medium underline">See it in the calendar →</Link></div>
        <ForecastChart rows={active.rows} compare={scenario !== "original" ? originalRows : undefined} />
      </Card>
    </>
  );
}

function Head({ icon: Icon, letter, title, badge }: { icon: typeof Mail; letter: string; title: string; badge?: boolean }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-black text-primary-foreground">{letter}</span>
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h2 className="font-semibold">{title}</h2>
      {badge && <SimBadge />}
    </div>
  );
}

function Result({ sum }: { sum: ReturnType<typeof summarize> }) {
  return (
    <p className={`mt-4 rounded-lg p-3 text-sm ${sum.shortage ? "bg-expense-soft text-expense" : "bg-income-soft text-income"}`}>
      Lowest balance becomes <b className="font-mono">{ron(sum.lowest)}</b> on {shortDate(sum.lowestDate)} — {sum.shortage ? `still short ${ron(sum.shortage)}` : "no shortage"}.
    </p>
  );
}
