/**
 * Typed, validated Raiffeisen Finance Pilot domain models.
 *
 * Every model has a Zod schema (runtime validation) and a TypeScript type
 * inferred from it, so the two can never drift apart. Schemas are strict:
 * unknown fields are rejected.
 *
 * Double-counting rule: forecasts sum CashEvents only. Invoices (Receivable,
 * supplier invoices) are documents; each links to exactly one CashEvent and
 * never contributes an amount on its own. See `./integrity.ts`.
 */
import { z } from "zod";

import { isBusinessDate } from "./dates";
import type { Bani, BusinessDate } from "./types";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Stable identifier: lowercase slug, e.g. `evt-cat-001`. */
export const idSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "IDs must be lowercase slugs (a-z, 0-9, -)");

export const baniSchema = z
  .number()
  .int("Amounts must be integer bani")
  .refine(Number.isSafeInteger, "Amounts must be safe integers")
  .transform((value) => value as Bani);

export const positiveBaniSchema = z
  .number()
  .int("Amounts must be integer bani")
  .positive("Amounts must be positive; direction carries the sign")
  .refine(Number.isSafeInteger, "Amounts must be safe integers")
  .transform((value) => value as Bani);

export const businessDateSchema = z
  .string()
  .refine(isBusinessDate, "Dates must be real calendar dates in YYYY-MM-DD format")
  .transform((value) => value as BusinessDate);

export const CURRENCIES = ["RON"] as const;
export const currencySchema = z.enum(CURRENCIES);
export type Currency = z.output<typeof currencySchema>;

// ---------------------------------------------------------------------------
// Shared value objects
// ---------------------------------------------------------------------------

export const SOURCE_KINDS = [
  "fixture",
  "receivable",
  "supplier_invoice",
  "scenario",
  "action_draft",
  "agent_run",
  "user",
] as const;

/** Where a record came from. `documentNumber` is the business document (e.g. invoice CAT-001). */
export const sourceRefSchema = z
  .object({
    kind: z.enum(SOURCE_KINDS),
    id: idSchema,
    documentNumber: z.string().min(1).nullable(),
  })
  .strict();
export type SourceRef = z.output<typeof sourceRefSchema>;

export const ASSUMPTION_KINDS = ["data", "simplification"] as const;

/** A statement a forecast depends on. `simplification` marks deliberate demo shortcuts. */
export const assumptionSchema = z
  .object({
    id: idSchema,
    kind: z.enum(ASSUMPTION_KINDS),
    text: z.string().min(1),
  })
  .strict();
export type Assumption = z.output<typeof assumptionSchema>;

// ---------------------------------------------------------------------------
// BusinessProfile
// ---------------------------------------------------------------------------

export const businessProfileSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    currency: currencySchema,
    /** IANA timezone used to interpret business dates. */
    timezone: z.string().min(1),
    /** Balance at the start of `asOf`; already includes all historical transactions. */
    openingBalance: z
      .object({
        amount: baniSchema,
        currency: currencySchema,
        asOf: businessDateSchema,
        position: z.literal("start_of_day"),
      })
      .strict(),
    /** Inclusive forecast horizon. */
    horizon: z
      .object({ start: businessDateSchema, end: businessDateSchema })
      .strict()
      .refine((h) => h.start <= h.end, "Horizon start must not be after its end"),
  })
  .strict();
export type BusinessProfile = z.output<typeof businessProfileSchema>;

// ---------------------------------------------------------------------------
// CashEvent
// ---------------------------------------------------------------------------

export const CASH_DIRECTIONS = ["inflow", "outflow"] as const;
export type CashDirection = (typeof CASH_DIRECTIONS)[number];

export const CASH_CATEGORIES = [
  "sales",
  "receivable",
  "supplier",
  "payroll",
  "rent",
  "utilities",
  "tax",
  "financing",
  "other",
] as const;
export type CashCategory = (typeof CASH_CATEGORIES)[number];

/** `forecast` = expected, not yet happened. `actual` = cash has actually moved. */
export const CASH_EVENT_STATUSES = ["forecast", "actual"] as const;
export type CashEventStatus = (typeof CASH_EVENT_STATUSES)[number];

/** `baseline` = original data, `scenario` = hypothetical, `accepted` = accepted forecast change. */
export const FORECAST_LAYERS = ["baseline", "scenario", "accepted"] as const;
export type ForecastLayer = (typeof FORECAST_LAYERS)[number];

export const cashEventSchema = z
  .object({
    id: idSchema,
    date: businessDateSchema,
    direction: z.enum(CASH_DIRECTIONS),
    amount: positiveBaniSchema,
    currency: currencySchema,
    category: z.enum(CASH_CATEGORIES),
    description: z.string().min(1),
    counterparty: z.string().min(1).nullable(),
    status: z.enum(CASH_EVENT_STATUSES),
    layer: z.enum(FORECAST_LAYERS),
    source: sourceRefSchema,
    /**
     * Present only on parts of an explicitly split event (e.g. an invoice paid in
     * two instalments). Parts share the document number; their amounts sum to the original.
     */
    split: z
      .object({
        parentId: idSchema,
        index: z.number().int().positive(),
        count: z.number().int().min(2),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CashEvent = z.output<typeof cashEventSchema>;

// ---------------------------------------------------------------------------
// Receivable
// ---------------------------------------------------------------------------

export const RECEIVABLE_STATUSES = ["open", "paid"] as const;
export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];

/** A customer invoice. Its cash effect lives only in the linked CashEvent. */
export const receivableSchema = z
  .object({
    id: idSchema,
    documentNumber: z.string().min(1),
    counterparty: z.string().min(1),
    amount: positiveBaniSchema,
    currency: currencySchema,
    expectedDate: businessDateSchema,
    status: z.enum(RECEIVABLE_STATUSES),
    /** The single CashEvent that carries this invoice's cash effect. */
    cashEventId: idSchema,
  })
  .strict();
export type Receivable = z.output<typeof receivableSchema>;

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

/** Reversible changes layered on top of the baseline; the baseline itself is never edited. */
export const scenarioAdjustmentSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("shift_event"), eventId: idSchema, newDate: businessDateSchema })
    .strict(),
  z.object({ type: z.literal("remove_event"), eventId: idSchema }).strict(),
  z.object({ type: z.literal("add_event"), event: cashEventSchema }).strict(),
  /** Replace one event by parts with absolute dates; part amounts must sum to the original. */
  z
    .object({
      type: z.literal("split_event"),
      eventId: idSchema,
      parts: z
        .array(
          z.object({ id: idSchema, date: businessDateSchema, amount: positiveBaniSchema }).strict(),
        )
        .min(2),
    })
    .strict(),
]);
export type ScenarioAdjustment = z.output<typeof scenarioAdjustmentSchema>;

/** `hypothetical` = what-if, `accepted` = accepted forecast change (not cash), `discarded` = reverted. */
export const SCENARIO_STATUSES = ["hypothetical", "accepted", "discarded"] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

export const scenarioSchema = z
  .object({
    id: idSchema,
    label: z.string().min(1),
    description: z.string(),
    status: z.enum(SCENARIO_STATUSES),
    baseDatasetVersion: z.string().min(1),
    createdOn: businessDateSchema,
    adjustments: z.array(scenarioAdjustmentSchema),
    assumptions: z.array(assumptionSchema),
    sources: z.array(sourceRefSchema),
  })
  .strict();
export type Scenario = z.output<typeof scenarioSchema>;

// ---------------------------------------------------------------------------
// Recovery terms (inputs for recovery scenarios; synthetic demo terms only)
// ---------------------------------------------------------------------------

const letterSchema = z.string().regex(/^[A-Z]$/, "Option letter must be A-Z");

export const recoveryTermsSchema = z.discriminatedUnion("kind", [
  /** Collect part of a receivable earlier; the remainder stays on its (delayed) date. */
  z
    .object({
      kind: z.literal("partial_collection"),
      id: idSchema,
      letter: letterSchema,
      title: z.string().min(1),
      documentNumber: z.string().min(1),
      partialAmount: positiveBaniSchema,
      partialDate: businessDateSchema,
    })
    .strict(),
  /** Pay a supplier invoice in two parts; the total payment is unchanged. */
  z
    .object({
      kind: z.literal("supplier_deferral"),
      id: idSchema,
      letter: letterSchema,
      title: z.string().min(1),
      documentNumber: z.string().min(1),
      firstAmount: positiveBaniSchema,
      firstDate: businessDateSchema,
      secondDate: businessDateSchema,
      fee: baniSchema.refine((v) => v >= 0, "Fee must not be negative"),
      feeAssumption: z.string().min(1),
    })
    .strict(),
  /** Fictional short-term financing: disbursement, one-time fee, principal repayment. */
  z
    .object({
      kind: z.literal("financing"),
      id: idSchema,
      letter: letterSchema,
      title: z.string().min(1),
      lenderLabel: z.string().min(1),
      principal: positiveBaniSchema,
      disbursementDate: businessDateSchema,
      fee: baniSchema.refine((v) => v >= 0, "Fee must not be negative"),
      feeDate: businessDateSchema,
      repaymentDate: businessDateSchema,
      disclaimer: z.string().min(1),
    })
    .strict(),
]);
export type RecoveryTerms = z.output<typeof recoveryTermsSchema>;

// ---------------------------------------------------------------------------
// ActionDraft
// ---------------------------------------------------------------------------

export const ACTION_DRAFT_KINDS = [
  "customer_payment_reminder",
  "supplier_payment_extension",
  "financing_inquiry",
  "other",
] as const;
export type ActionDraftKind = (typeof ACTION_DRAFT_KINDS)[number];

/**
 * Drafts are never sent. `awaiting_response` means the user said they sent it themselves
 * outside Raiffeisen Finance Pilot; `accepted` and `rejected` are simulated responses only.
 */
export const ACTION_DRAFT_STATUSES = [
  "draft",
  "awaiting_response",
  "accepted",
  "rejected",
] as const;
export type ActionDraftStatus = (typeof ACTION_DRAFT_STATUSES)[number];

export const ACTION_DRAFT_EVENTS = [
  "generated",
  "regenerated",
  "edited",
  "marked_awaiting",
  "accepted",
  "rejected",
] as const;

/** One audit entry. `at` is the wall-clock time it was recorded; `businessDate` is the demo date. */
export const actionDraftHistoryEntrySchema = z
  .object({
    event: z.enum(ACTION_DRAFT_EVENTS),
    status: z.enum(ACTION_DRAFT_STATUSES),
    at: z.string().datetime(),
    businessDate: businessDateSchema,
    /** Session data revision when the entry was recorded. */
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type ActionDraftHistoryEntry = z.output<typeof actionDraftHistoryEntrySchema>;

export const actionDraftSchema = z
  .object({
    id: idSchema,
    kind: z.enum(ACTION_DRAFT_KINDS),
    /** `email` = message to a counterparty; `brief` = Markdown meeting brief. */
    format: z.enum(["email", "brief"]),
    /** Recovery option this draft proposes. */
    optionId: idSchema,
    scenarioId: idSchema.nullable(),
    recipientLabel: z.string().min(1),
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(20_000),
    status: z.enum(ACTION_DRAFT_STATUSES),
    createdOn: businessDateSchema,
    sources: z.array(sourceRefSchema),
    /** What the draft was generated from. Freshness is checked against this. */
    basis: z
      .object({
        datasetVersion: z.string().min(1),
        revision: z.number().int().nonnegative(),
        /** The proposal's own adjustments (on top of the active case) that acceptance applies. */
        proposal: z.array(scenarioAdjustmentSchema).min(1),
        /** Hash of the generated subject and body; detects changed figures even after edits. */
        fingerprint: z.string().min(1),
      })
      .strict(),
    /** True once the user edited subject or body. */
    edited: z.boolean(),
    history: z.array(actionDraftHistoryEntrySchema).min(1),
  })
  .strict();
export type ActionDraft = z.output<typeof actionDraftSchema>;

/**
 * A proposal whose acceptance was simulated. Its adjustments are an accepted forecast
 * change layered on the baseline; it never changes the opening (actual) cash and never
 * marks an invoice paid.
 */
export const acceptedChangeSchema = z
  .object({
    id: idSchema,
    draftId: idSchema,
    optionId: idSchema,
    label: z.string().min(1),
    description: z.string().min(1),
    adjustments: z.array(scenarioAdjustmentSchema).min(1),
    acceptedAt: z.string().datetime(),
    businessDate: businessDateSchema,
    /** Session revision at acceptance, and the revision the draft was generated at. */
    sourceRevision: z.number().int().nonnegative(),
    draftRevision: z.number().int().nonnegative(),
    datasetVersion: z.string().min(1),
  })
  .strict();
export type AcceptedChange = z.output<typeof acceptedChangeSchema>;

// ---------------------------------------------------------------------------
// AgentRun
// ---------------------------------------------------------------------------

/** Deterministic tools the AI may request. Their results always come from domain code. */
export const AGENT_TOOL_NAMES = [
  "get_business_context",
  "get_cash_events",
  "calculate_forecast",
  "simulate_payment_delay",
  "compare_recovery_scenarios",
  "prepare_action_draft",
  "update_planning_constraints",
  "request_missing_information",
] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Plain JSON data (what a recorded tool input may contain). */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

/** The only kinds of step an agent run may contain. */
export const agentStepSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("tool_call"),
      id: idSchema,
      tool: z.enum(AGENT_TOOL_NAMES),
      /** The validated input the tool actually ran with (or the raw input when validation failed). */
      input: z.record(jsonValueSchema),
      /** Reference to the deterministic result record; null until the tool has run. */
      resultRef: sourceRefSchema.nullable(),
      ok: z.boolean(),
      /** Deterministic one-line summary of the tool result, generated by code. */
      summary: z.string(),
      /** Structured error code when ok is false. */
      errorCode: z.string().nullable(),
      /** Measured wall-clock duration of the handler on the server. */
      durationMs: z.number().nonnegative(),
      /** Source records (events, receivables, scenarios, drafts) the result relied on. */
      sourceIds: z.array(z.string()),
    })
    .strict(),
  z
    .object({ kind: z.literal("missing_information"), id: idSchema, question: z.string().min(1) })
    .strict(),
  z
    .object({
      kind: z.literal("explanation"),
      id: idSchema,
      text: z.string().min(1),
      basedOnStepId: idSchema,
    })
    .strict(),
  z.object({ kind: z.literal("draft"), id: idSchema, actionDraftId: idSchema }).strict(),
]);
export type AgentStep = z.output<typeof agentStepSchema>;

export const AGENT_RUN_STATUSES = ["running", "needs_input", "completed", "failed"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/** A recovery option the user said is not available (e.g. "the supplier refused"). */
export const rejectedOptionSchema = z
  .object({ optionId: idSchema, reason: z.string().min(1).max(200) })
  .strict();
export type RejectedOption = z.output<typeof rejectedOptionSchema>;

/** `live` = Lovable AI chose the tools; `guided` = deterministic scripted demo, no AI involved. */
export const AGENT_RUN_MODES = ["live", "guided"] as const;
export type AgentRunMode = (typeof AGENT_RUN_MODES)[number];

export const agentRunSchema = z
  .object({
    id: idSchema,
    mode: z.enum(AGENT_RUN_MODES),
    question: z.string(),
    answer: z.string(),
    datasetVersion: z.string().min(1),
    /** Session data revision the run started from. */
    startRevision: z.number().int().nonnegative(),
    /** Session data revision after the run's own hypothetical changes. Older = stale answer. */
    endRevision: z.number().int().nonnegative(),
    /** Deduplicated assumptions reported by the tools this run used. */
    assumptions: z.array(z.string()),
    /** Model tool calls refused before execution (unknown tool, invalid arguments, over budget). */
    rejectedToolCalls: z.array(z.object({ toolName: z.string(), reason: z.string() }).strict()),
    scenarioId: idSchema.nullable(),
    status: z.enum(AGENT_RUN_STATUSES),
    startedOn: businessDateSchema,
    steps: z.array(agentStepSchema),
  })
  .strict();
export type AgentRun = z.output<typeof agentRunSchema>;

// ---------------------------------------------------------------------------
// DemoDataset
// ---------------------------------------------------------------------------

export const datasetSourceSchema = z
  .object({ kind: z.literal("synthetic"), label: z.string().min(1) })
  .strict();

export const demoDatasetSchema = z
  .object({
    datasetVersion: z.string().min(1),
    source: datasetSourceSchema,
    profile: businessProfileSchema,
    cashEvents: z.array(cashEventSchema),
    receivables: z.array(receivableSchema),
    assumptions: z.array(assumptionSchema),
  })
  .strict();
export type DemoDataset = z.output<typeof demoDatasetSchema>;
