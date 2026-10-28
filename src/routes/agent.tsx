import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Bot, Send, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { agentAnswer, agentSummary } from "@/biz/model";
import { useBiz } from "@/biz/store";
import { AlertList, Card, PageTitle, inputCls } from "@/biz/ui";

export const Route = createFileRoute("/agent")({
  head: () => ({
    meta: [
      { title: "AI Financial Agent — Raiffeisen Business AI" },
      { name: "description", content: "Ask the AI agent about cash shortages, customer payments and solutions." },
      { property: "og:title", content: "AI Financial Agent — Raiffeisen Business AI" },
      { property: "og:description", content: "Interactive cash-flow assistant using your live forecast." },
    ],
  }),
  component: AgentPage,
});

const SUGGESTIONS = [
  "When will I run out of money?",
  "How much extra money do I need?",
  "Which expenses cause the problem?",
  "When do customer payments arrive?",
  "What if the school pays late?",
  "What should I do?",
];

function AgentPage() {
  const { scenarioTx, rows, solutions, alerts } = useBiz();
  const [msgs, setMsgs] = useState<{ role: "user" | "agent"; text: string }[]>([]);
  const [q, setQ] = useState("");
  const ask = (text: string) => {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { role: "user", text }, { role: "agent", text: agentAnswer(text, scenarioTx, rows, solutions) }]);
    setQ("");
  };
  return (
    <>
      <PageTitle title="AI Financial Agent" sub="Analyses every day of the month using your live data. Answers are computed from the forecast — never invented." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="flex min-h-[520px] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto">
            <Bubble role="agent" text={agentSummary(scenarioTx, rows)} />
            {msgs.map((m, i) => <Bubble key={i} {...m} />)}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent">{s}</button>)}
          </div>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
            <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your cash flow…" />
            <Button type="submit"><Send className="h-4 w-4" /></Button>
          </form>
        </Card>
        <Card className="h-fit">
          <h2 className="mb-3 font-semibold">Proactive alerts</h2>
          <AlertList alerts={alerts} />
        </Card>
      </div>
    </>
  );
}

function Bubble({ role, text }: { role: "user" | "agent"; text: string }) {
  const agent = role === "agent";
  return (
    <div className={`flex gap-3 ${agent ? "" : "flex-row-reverse"}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${agent ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{agent ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}</span>
      <p className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed ${agent ? "bg-muted" : "bg-accent"}`}>{text}</p>
    </div>
  );
}
