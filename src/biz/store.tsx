import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  MONTHS,
  applyScenario,
  calculateDailyBalances,
  defaultSolutions,
  detectAlerts,
  seedTransactions,
  summarize,
  type MonthKey,
  type ScenarioId,
  type SolutionSettings,
  type Transaction,
} from "./model";

export type RequestStatus =
  | "Submitted"
  | "Under Review"
  | "Additional Information Required"
  | "Approved in Simulation"
  | "Rejected in Simulation";

export interface FinancingRequest {
  id: string;
  company: string;
  amount: number;
  rate: number;
  days: number;
  reason: string;
  expectedPaymentDate: string;
  status: RequestStatus;
  createdAt: string;
}

interface Persisted {
  v: number;
  transactions: Transaction[];
  solutions: SolutionSettings;
  scenario: ScenarioId;
  month: MonthKey;
  requests: FinancingRequest[];
}

const KEY = "raiffeisen-business-ai";
const V = 1;
const initial = (): Persisted => ({
  v: V,
  transactions: seedTransactions(),
  solutions: defaultSolutions(),
  scenario: "original",
  month: MONTHS[0],
  requests: [],
});

function useBizState() {
  const [state, setState] = useState<Persisted>(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw) as Persisted;
        if (p.v === V) setState(p);
      }
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(KEY, JSON.stringify(state));
  }, [state, loaded]);

  const scenarioTx = useMemo(
    () => applyScenario(state.transactions, state.scenario, state.solutions),
    [state.transactions, state.scenario, state.solutions],
  );
  const rows = useMemo(() => calculateDailyBalances(scenarioTx, state.month), [scenarioTx, state.month]);
  const originalRows = useMemo(
    () => calculateDailyBalances(state.transactions, state.month),
    [state.transactions, state.month],
  );
  const summary = useMemo(() => summarize(rows), [rows]);
  const alerts = useMemo(() => detectAlerts(scenarioTx, rows), [scenarioTx, rows]);

  const set = (patch: Partial<Persisted>) => setState((s) => ({ ...s, ...patch }));
  return {
    ...state,
    scenarioTx,
    rows,
    originalRows,
    summary,
    alerts,
    setMonth: (month: MonthKey) => set({ month }),
    setScenario: (scenario: ScenarioId) => set({ scenario }),
    setSolutions: (p: Partial<SolutionSettings>) =>
      setState((s) => ({ ...s, solutions: { ...s.solutions, ...p } })),
    upsertTx: (tx: Transaction) =>
      setState((s) => ({
        ...s,
        transactions: s.transactions.some((t) => t.id === tx.id)
          ? s.transactions.map((t) => (t.id === tx.id ? tx : t))
          : [...s.transactions, tx],
      })),
    deleteTx: (id: string) => setState((s) => ({ ...s, transactions: s.transactions.filter((t) => t.id !== id) })),
    addMany: (txs: Transaction[]) => setState((s) => ({ ...s, transactions: [...s.transactions, ...txs] })),
    submitRequest: (r: Omit<FinancingRequest, "id" | "status" | "createdAt">) =>
      setState((s) => ({
        ...s,
        requests: [
          { ...r, id: `REQ-${String(s.requests.length + 1).padStart(3, "0")}`, status: "Submitted", createdAt: new Date().toISOString() },
          ...s.requests,
        ],
      })),
    setRequestStatus: (id: string, status: RequestStatus) =>
      setState((s) => ({ ...s, requests: s.requests.map((r) => (r.id === id ? { ...r, status } : r)) })),
    reset: () => setState(initial()),
  };
}

type Biz = ReturnType<typeof useBizState>;
const Ctx = createContext<Biz | null>(null);

export function BizProvider({ children }: { children: ReactNode }) {
  const v = useBizState();
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useBiz() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBiz outside BizProvider");
  return v;
}

export const ron = (n: number) =>
  `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("ro-RO", { maximumFractionDigits: 2 })} RON`;
export const shortDate = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
