import { describe, expect, it } from "vitest";
import { applyScenario, calculateDailyBalances, defaultSolutions, detectAlerts, loanCost, parseImportRows, seedTransactions, summarize } from "./model";

const tx = seedTransactions();

describe("Bucharest Coffee forecast", () => {
  it("starts at 12,000 RON and goes negative on the 5th before the school pays on the 15th", () => {
    const rows = calculateDailyBalances(tx, "2026-11");
    expect(rows).toHaveLength(30);
    expect(rows[0]!.opening).toBe(12000);
    const s = summarize(rows);
    expect(s.firstNegative).toBe("2026-11-05");
    expect(s.shortage).toBeGreaterThan(0);
    expect(rows.find((r) => r.date === "2026-11-15")!.income).toBe(11300);
  });
  it("financing interest = amount × rate × days / 365", () => {
    expect(loanCost({ loanAmount: 5000, loanRate: 1.5, loanDays: 10 }).interest).toBe(2.05);
  });
  it("combined solution removes the shortage without touching original data", () => {
    const combined = applyScenario(tx, "combined", defaultSolutions());
    expect(summarize(calculateDailyBalances(combined, "2026-11")).shortage).toBe(0);
    expect(tx.find((t) => t.id === "school")!.date).toBe("2026-11-15");
  });
  it("alerts flag the negative day", () => {
    expect(detectAlerts(tx, calculateDailyBalances(tx, "2026-11"))[0]!.level).toBe("critical");
  });
  it("import validates rows", () => {
    const r = parseImportRows([{ date: "2026-11-09", type: "income", description: "x", amount: "100" }, { date: "bad", type: "x", amount: 0 }]);
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
  });
});
