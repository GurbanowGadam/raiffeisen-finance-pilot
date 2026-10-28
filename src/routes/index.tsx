import { createFileRoute, Link } from "@tanstack/react-router";
import { Bot, ArrowRight } from "lucide-react";

import { agentSummary, COMPANY } from "@/biz/model";
import { ron, shortDate, useBiz } from "@/biz/store";
import { AlertList, Card, ForecastChart, PageTitle, ScenarioBar, Stat } from "@/biz/ui";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Raiffeisen Business AI" },
      { name: "description", content: "Monthly cash-flow forecast and AI risk alerts for Bucharest Coffee SRL." },
      { property: "og:title", content: "Raiffeisen Business AI — Dashboard" },
      { property: "og:description", content: "AI financial manager concept demo for Romanian SRLs." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { summary: s, rows, originalRows, alerts, scenario, scenarioTx } = useBiz();
  return (
    <>
      <PageTitle title={`Good afternoon, ${COMPANY}`} sub="Your full-month cash-flow forecast, recalculated every time your data changes." />
      <ScenarioBar />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Current balance" value={ron(s.currentBalance)} />
        <Stat label="Expected income" value={ron(s.income)} tone="good" />
        <Stat label="Expected expenses" value={ron(s.expenses)} tone="bad" />
        <Stat label="Projected month-end" value={ron(s.monthEnd)} tone={s.monthEnd < 0 ? "bad" : "good"} />
        <Stat label="Lowest projected balance" value={ron(s.lowest)} tone={s.lowest < 0 ? "bad" : s.lowest < 3000 ? "warn" : "good"} hint={`on ${shortDate(s.lowestDate)}`} />
        <Stat label="Potential funding shortage" value={s.shortage ? ron(s.shortage) : "None"} tone={s.shortage ? "bad" : "good"} hint={s.firstNegative ? `from ${shortDate(s.firstNegative)}, ${s.negativeDays} day(s)` : "Balance stays positive"} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Projected balance, every day</h2>
            <Link to="/calendar" className="text-xs font-medium text-muted-foreground hover:text-foreground">Open calendar →</Link>
          </div>
          <ForecastChart rows={rows} compare={scenario !== "original" ? originalRows : undefined} />
        </Card>
        <Card>
          <div className="mb-3 flex items-center gap-2"><Bot className="h-4 w-4" /><h2 className="font-semibold">AI agent</h2></div>
          <p className="text-sm leading-relaxed">{agentSummary(scenarioTx, rows)}</p>
          <Link to="/solutions" className="mt-4 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">See solutions <ArrowRight className="h-4 w-4" /></Link>
        </Card>
      </div>
      <Card className="mt-6">
        <h2 className="mb-3 font-semibold">Notifications</h2>
        <AlertList alerts={alerts} />
      </Card>
    </>
  );
}
