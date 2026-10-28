import { Link } from "@tanstack/react-router";
import { Bot, CalendarDays, Landmark, LayoutDashboard, ListOrdered, Lightbulb, RotateCcw, Upload } from "lucide-react";
import type { ReactNode } from "react";

import { COMPANY } from "@/biz/model";
import { useBiz } from "@/biz/store";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/calendar", label: "Cash-flow calendar", icon: CalendarDays },
  { to: "/transactions", label: "Income & expenses", icon: ListOrdered },
  { to: "/upload", label: "Upload data", icon: Upload },
  { to: "/agent", label: "AI Financial Agent", icon: Bot },
  { to: "/solutions", label: "Solutions", icon: Lightbulb },
  { to: "/bank", label: "Bank dashboard", icon: Landmark },
] as const;

const LINK =
  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-muted data-[status=active]:bg-sidebar-accent data-[status=active]:font-semibold data-[status=active]:text-sidebar-accent-foreground";

export function AppShell({ children }: { children: ReactNode }) {
  const { alerts, reset } = useBiz();
  const critical = alerts.filter((a) => a.level !== "info").length;
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex items-center gap-3 px-5 py-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-lg font-black text-primary-foreground">R</span>
          <div className="leading-tight">
            <p className="text-sm font-extrabold">Raiffeisen</p>
            <p className="text-xs font-medium text-muted-foreground">Business AI</p>
          </div>
        </div>
        <div className="mx-4 mb-4 rounded-lg bg-muted px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Company</p>
          <p className="text-sm font-semibold">{COMPANY}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} activeOptions={{ exact: true }} className={LINK}>
              <Icon className="h-4 w-4" />
              <span className="flex-1">{label}</span>
              {to === "/agent" && critical > 0 && (
                <span className="rounded-full bg-expense px-1.5 text-[10px] font-bold text-primary-foreground">{critical}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="space-y-3 p-4">
          <button onClick={reset} className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2 text-xs font-medium text-muted-foreground hover:bg-muted">
            <RotateCcw className="h-3.5 w-3.5" /> Reset demo data
          </button>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Concept demo. Not an official Raiffeisen Bank application. All bank interactions are simulated.
          </p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card px-3 py-2 md:hidden">
          {NAV.map(({ to, label }) => (
            <Link key={to} to={to} activeOptions={{ exact: true }} className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground data-[status=active]:bg-primary data-[status=active]:text-primary-foreground">
              {label}
            </Link>
          ))}
        </nav>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
