import { createFileRoute, Link } from "@tanstack/react-router";

import type { RequestStatus } from "@/biz/store";
import { ron, shortDate, useBiz } from "@/biz/store";
import { Card, PageTitle, SimBadge } from "@/biz/ui";

export const Route = createFileRoute("/bank")({
  head: () => ({
    meta: [
      { title: "Simulated bank dashboard — Raiffeisen Business AI" },
      { name: "description", content: "Simulated Raiffeisen relationship-manager view of financing inquiries." },
      { property: "og:title", content: "Simulated bank dashboard — Raiffeisen Business AI" },
      { property: "og:description", content: "Demo financing request workflow." },
    ],
  }),
  component: BankPage,
});

const STATUSES: RequestStatus[] = ["Submitted", "Under Review", "Additional Information Required", "Approved in Simulation", "Rejected in Simulation"];
const tone = (s: RequestStatus) =>
  s.startsWith("Approved") ? "bg-income-soft text-income" : s.startsWith("Rejected") ? "bg-expense-soft text-expense" : s.startsWith("Additional") ? "bg-warning/10 text-warning" : "bg-muted text-foreground";

function BankPage() {
  const { requests, setRequestStatus } = useBiz();
  return (
    <>
      <PageTitle title="Bank dashboard" sub="Demo operator view. No real bank system is connected and no request is actually received by Raiffeisen Bank." right={<SimBadge />} />
      {requests.length === 0 ? (
        <Card className="text-center text-sm text-muted-foreground">No financing inquiries yet. <Link to="/solutions" className="font-semibold text-foreground underline">Prepare one from Solutions</Link>.</Card>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">{r.id} · {new Date(r.createdAt).toLocaleString("en-GB")}</p>
                  <h2 className="text-lg font-bold">{r.company}</h2>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(r.status)}`}>{r.status}</span>
              </div>
              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-muted-foreground">Requested amount</dt><dd className="font-mono font-semibold">{ron(r.amount)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Illustrative terms</dt><dd>{r.rate}% / {r.days} days</dd></div>
                <div><dt className="text-xs text-muted-foreground">Expected customer payment</dt><dd>{r.expectedPaymentDate ? shortDate(r.expectedPaymentDate) : "—"}</dd></div>
                <div className="sm:col-span-4"><dt className="text-xs text-muted-foreground">Reason</dt><dd>{r.reason}</dd></div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                <span className="mr-2 self-center text-xs text-muted-foreground">Set status (demo operator):</span>
                {STATUSES.map((s) => (
                  <button key={s} onClick={() => setRequestStatus(r.id, s)} className={`rounded-md border px-2.5 py-1 text-xs ${r.status === s ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border hover:bg-muted"}`}>{s}</button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
