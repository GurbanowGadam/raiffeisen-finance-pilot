/**
 * Guided demo mode: a fixed, deterministic tool sequence with a templated answer.
 *
 * Used when live AI is unavailable or not wanted. It runs the same real tools
 * through the same runner (so the trace is real) but involves no language model,
 * does not interpret the user's question, and always says so.
 */
import { GUIDED_MODE_LABEL } from "./agent-contract";
import type { ToolResult, ToolSuccess } from "./tools/envelope";
import { runTool, type RunContext } from "./tools/runner";

export { GUIDED_MODE_LABEL };

type Data = Record<string, unknown>;
const data = (r: ToolResult): Data | null =>
  r.ok ? ((r as ToolSuccess<Data>).data ?? null) : null;
const text = (v: unknown): string =>
  v && typeof v === "object" && "text" in v ? String((v as { text: unknown }).text) : String(v);

export function runGuidedDemo(ctx: RunContext): string {
  const lines: string[] = [
    GUIDED_MODE_LABEL,
    "Your question is not interpreted in this mode; the same steps always run.",
    "",
  ];

  const context = runTool(ctx, "get_business_context", {});
  const c = data(context);
  const baseline = runTool(ctx, "calculate_forecast", {
    view: "baseline",
    includeDailyRows: false,
  });
  const b = data(baseline);
  if (b) {
    lines.push(
      `Baseline: lowest daily close ${text(b["minimumClosingBalance"])} on ${String(b["minimumClosingDate"])}, ${b["firstNegativeClosingDate"] ? `first negative day ${String(b["firstNegativeClosingDate"])}` : "no negative day"}, ending ${text(b["endingBalance"])}.`,
    );
  }

  const receivables =
    (c?.["openReceivables"] as { documentNumber: string; expectedDate: string }[] | undefined) ??
    [];
  const hasDelay = Boolean(c?.["activeDelay"]);
  if (!hasDelay && receivables[0]) {
    const r = receivables[0];
    runTool(ctx, "simulate_payment_delay", {
      documentNumber: r.documentNumber,
      delayDays: 14,
      newDate: null,
    });
  } else if (!hasDelay) {
    lines.push("There is no open receivable to delay, so the guided demo stops here.");
    return lines.join("\n");
  }

  const delayed = runTool(ctx, "calculate_forecast", {
    view: "active_case",
    includeDailyRows: false,
  });
  const d = data(delayed);
  if (d) {
    lines.push(
      `Delayed case (hypothetical): lowest daily close ${text(d["minimumClosingBalance"])} on ${String(d["minimumClosingDate"])}${d["firstNegativeClosingDate"] ? `, below 0 RON from ${String(d["firstNegativeClosingDate"])}` : ""}${d["recoveryDate"] ? `, back at or above 0 RON on ${String(d["recoveryDate"])}` : ""}, ending ${text(d["endingBalance"])}.`,
    );
  }

  const comparison = runTool(ctx, "compare_recovery_scenarios", { bufferRon: null });
  const cmp = data(comparison);
  if (cmp) {
    lines.push(
      "",
      `Recovery options at a ${text(cmp["buffer"])} buffer (independent, hypothetical, not approved):`,
    );
    for (const o of (cmp["options"] as Data[]) ?? []) {
      if (!o["available"]) {
        lines.push(
          `- ${String(o["letter"])}. ${String(o["title"])}: not available (${String(o["reason"])}).`,
        );
        continue;
      }
      const approvals = ((o["approvals"] as { party: string; kind: string }[]) ?? [])
        .map(
          (a) => `${a.kind === "bank_approval" ? "bank approval" : "acceptance"} from ${a.party}`,
        )
        .join(", ");
      lines.push(
        `- ${String(o["letter"])}. ${String(o["title"])}: lowest ${text(o["lowestCash"])}, ending ${text(o["endingCash"])}, explicit cost ${text(o["totalExplicitCost"])}, ${o["passesBuffer"] ? "meets" : "fails"} the buffer; needs ${approvals}.`,
      );
    }
    const finding = cmp["finding"] as
      { kind: string; closestGap?: { text: string } | null } | undefined;
    if (finding?.kind === "all_fail") {
      lines.push(
        `No option meets the buffer${finding.closestGap ? `; the closest falls short by ${finding.closestGap.text}` : ""}.`,
      );
    }
  } else if (!comparison.ok) {
    lines.push(`Recovery comparison unavailable: ${comparison.error.message}`);
  }

  lines.push("", "Nothing was sent or paid. Approvals have not been requested.");
  return lines.join("\n");
}
