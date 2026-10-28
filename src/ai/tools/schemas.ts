/**
 * Tool contracts. Each tool has a strict Zod input schema that is both sent to the
 * model (converted to strict-compatible JSON Schema: every property required,
 * optional values nullable, no extra properties) and used to validate inputs
 * before any handler runs. Semantic checks (real dates, amounts, ids) happen in
 * the handlers and return structured errors.
 *
 * Schemas deliberately avoid length bounds, patterns and long enums, which strict
 * tool calling rejects or handles poorly; those rules are enforced in code.
 *
 * No tool can move money, send a message, submit an application or approve
 * anything. Mutating tools only create hypothetical scenarios, unsent drafts or
 * planning constraints in the run's private session copy.
 */
import { z } from "zod";

import { AGENT_TOOL_NAMES, type AgentToolName } from "@/domain";

export const TOOL_NAMES = AGENT_TOOL_NAMES;
export type ToolName = AgentToolName;

const view = z
  .enum(["baseline", "active_case"])
  .describe(
    "baseline = original data; active_case = baseline plus the active hypothetical payment delay (same as baseline when none is active)",
  );

export const RECOVERY_OPTION_IDS = [
  "recovery-partial-collection",
  "recovery-supplier-deferral",
  "recovery-fictional-financing",
] as const;

const optionId = z.enum(RECOVERY_OPTION_IDS);

export const TOOL_INPUT_SCHEMAS = {
  get_business_context: z.object({}).strict(),
  get_cash_events: z
    .object({
      view,
      fromDate: z.string().nullable().describe("Inclusive YYYY-MM-DD lower bound, or null"),
      toDate: z.string().nullable().describe("Inclusive YYYY-MM-DD upper bound, or null"),
      direction: z.enum(["inflow", "outflow"]).nullable().describe("Filter, or null for both"),
      limit: z
        .number()
        .int()
        .nullable()
        .describe("Maximum events to return (1-100), or null for 50"),
    })
    .strict(),
  calculate_forecast: z
    .object({
      view,
      includeDailyRows: z.boolean().describe("true to include every day's closing balance"),
    })
    .strict(),
  simulate_payment_delay: z
    .object({
      documentNumber: z.string().describe("Invoice number of an open receivable, e.g. CAT-001"),
      delayDays: z
        .number()
        .int()
        .nullable()
        .describe(
          "Days late relative to the original expected date (e.g. 14). The server computes the date. Give this OR newDate.",
        ),
      newDate: z
        .string()
        .nullable()
        .describe(
          "Explicit new expected date YYYY-MM-DD, only if the user gave a date. Give this OR delayDays.",
        ),
    })
    .strict(),
  compare_recovery_scenarios: z
    .object({
      bufferRon: z
        .string()
        .nullable()
        .describe(
          'Minimum cash buffer in RON for this comparison only, e.g. "1000.00"; null uses the session buffer',
        ),
    })
    .strict(),
  prepare_action_draft: z
    .object({
      optionId: optionId.describe("Recovery option to draft a message for"),
    })
    .strict(),
  update_planning_constraints: z
    .object({
      minimumCashBufferRon: z
        .string()
        .nullable()
        .describe(
          'Minimum daily closing cash the user requires, in RON, e.g. "2000.00"; null leaves it unchanged',
        ),
      rejectOptionId: optionId
        .nullable()
        .describe("Recovery option the user says is refused or not acceptable; null for none"),
      rejectionReason: z
        .string()
        .nullable()
        .describe("Short reason in the user's words; required with rejectOptionId"),
      reinstateOptionId: optionId
        .nullable()
        .describe("Previously rejected option the user wants considered again; null for none"),
    })
    .strict(),
  request_missing_information: z
    .object({
      question: z.string().describe("One concise question for the user"),
      missing: z
        .array(z.string())
        .describe('What is missing, e.g. ["which payment", "how many days late"]'),
    })
    .strict(),
} as const satisfies Record<ToolName, z.ZodTypeAny>;

export type ToolInput<N extends ToolName> = z.output<(typeof TOOL_INPUT_SCHEMAS)[N]>;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_business_context:
    "Business profile, opening balance, forecast horizon, demo date, planning constraints (cash buffer, rejected options), open receivables and the active hypothetical delay, if any.",
  get_cash_events:
    "List dated cash events (amounts in bani and formatted RON) with source, status and layer. Read-only.",
  calculate_forecast:
    "Deterministic daily closing-balance forecast: lowest balance and date, first negative day, shortfall, recovery date, ending balance.",
  simulate_payment_delay:
    "Create or update the single hypothetical payment-delay scenario for an open receivable, given days late or an explicit date. Returns the delayed-case forecast. Does not move any real payment; the baseline is unchanged.",
  compare_recovery_scenarios:
    "Compare the independent recovery options (partial collection, supplier deferral, fictional financing) against the active delayed case, honouring the session's minimum cash buffer and rejected options. Requires an active payment delay.",
  prepare_action_draft:
    "Prepare a message draft for one recovery option. The draft is stored for review only and is never sent.",
  update_planning_constraints:
    "Record a constraint the user stated: a minimum daily cash buffer, a refused recovery option, or reinstating one. Planning input only; no money moves.",
  request_missing_information:
    "Ask the user for information you need and cannot get from the tools (e.g. which payment, how late). Use instead of guessing.",
};
