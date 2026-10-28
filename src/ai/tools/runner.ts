/**
 * Tool runner: validation, limits and the real invocation trace.
 *
 * Every tool call, from live AI or from the guided demo, goes through `runTool`.
 * The trace entry is written here, around the actual handler execution, so it can
 * never describe a call that did not happen. It records the validated input, a
 * deterministic result summary and the measured duration; no model reasoning.
 */
import type { AgentStep, JsonValue } from "@/domain";

import type { ToolResult } from "./envelope";
import { TOOL_HANDLERS } from "./handlers";
import { AGENT_LIMITS } from "./limits";

export type LimitOverrides = Partial<Record<keyof typeof AGENT_LIMITS, number>>;
import { TOOL_INPUT_SCHEMAS, TOOL_NAMES, type ToolName } from "./schemas";
import type { ToolSession } from "./session";

export type TraceEntry = Extract<AgentStep, { kind: "tool_call" }>;

/** A model tool call refused before reaching a handler. */
export interface RejectedToolCall {
  readonly toolName: string;
  readonly reason: string;
}

export interface RunContext {
  readonly session: ToolSession;
  readonly trace: TraceEntry[];
  /** Calls the SDK refused (unknown tool, schema-invalid arguments). Not executed. */
  readonly rejected: RejectedToolCall[];
  /** Deduplicated assumptions reported by successful tool results, in first-seen order. */
  readonly assumptions: string[];
  readonly startedAt: number;
  /** Clock in milliseconds; injectable for tests. */
  readonly now: () => number;
  readonly limits?: LimitOverrides;
}

export function createRunContext(
  session: ToolSession,
  options: { now?: () => number; limits?: LimitOverrides } = {},
): RunContext {
  const now = options.now ?? (() => performance.now());
  return {
    session,
    trace: [],
    rejected: [],
    assumptions: [],
    startedAt: now(),
    now,
    ...(options.limits ? { limits: options.limits } : {}),
  };
}

const limit = (ctx: RunContext, key: keyof typeof AGENT_LIMITS): number =>
  ctx.limits?.[key] ?? AGENT_LIMITS[key];

/** True when no further tool calls may start (call count, refused calls or runtime budget spent). */
export function toolBudgetExhausted(ctx: RunContext): boolean {
  return (
    ctx.trace.length >= limit(ctx, "maxToolCalls") ||
    ctx.rejected.length >= limit(ctx, "maxRejectedToolCalls") ||
    ctx.now() - ctx.startedAt >= limit(ctx, "runBudgetMs")
  );
}

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

/** Records the input as plain JSON (non-JSON values are dropped by serialisation). */
function asRecord(value: unknown): Record<string, JsonValue> {
  let json: JsonValue = null;
  try {
    json = (JSON.parse(JSON.stringify(value ?? null)) as JsonValue) ?? null;
  } catch {
    json = "[unserialisable input]";
  }
  return json && typeof json === "object" && !Array.isArray(json) ? json : { value: json };
}

/** Validates, enforces limits, runs the handler and appends one trace entry. */
export function runTool(ctx: RunContext, name: string, rawInput: unknown): ToolResult {
  const { session } = ctx;
  const started = ctx.now();
  const record = (result: ToolResult, input: unknown): ToolResult => {
    if (result.ok) {
      for (const a of result.assumptions) if (!ctx.assumptions.includes(a)) ctx.assumptions.push(a);
    }
    ctx.trace.push({
      kind: "tool_call",
      id: `call-${ctx.trace.length + 1}`,
      tool: result.tool,
      input: asRecord(input),
      resultRef:
        result.ok && result.mutation && result.mutation.kind !== "constraints"
          ? {
              kind: result.mutation.kind,
              id: result.mutation.id,
              documentNumber: null,
            }
          : null,
      ok: result.ok,
      summary: result.summary,
      errorCode: result.ok ? null : result.error.code,
      durationMs: Math.max(0, ctx.now() - started),
      sourceIds: result.ok ? [...result.sourceIds] : [],
    });
    return result;
  };
  const meta = {
    datasetVersion: session.state.baseline.datasetVersion,
    revision: session.state.revision,
  };

  if (!isToolName(name)) {
    // Not traceable as a known tool; record the refusal without running anything.
    ctx.rejected.push({ toolName: name.slice(0, 80), reason: "Unknown tool" });
    return {
      ok: false,
      tool: "get_business_context",
      ...meta,
      error: { code: "unknown_tool", message: `Unknown tool "${name}"`, issues: [] },
      summary: `Error (unknown_tool): ${name}`,
    };
  }

  if (ctx.trace.length >= limit(ctx, "maxToolCalls")) {
    return record(
      {
        ok: false,
        tool: name,
        ...meta,
        error: {
          code: "limit_exceeded",
          message: `Tool call limit reached (${limit(ctx, "maxToolCalls")} per run). Answer with the results you have.`,
          issues: [],
        },
        summary: "Error (limit_exceeded): tool call limit reached",
      },
      rawInput,
    );
  }
  if (ctx.now() - ctx.startedAt >= limit(ctx, "runBudgetMs")) {
    return record(
      {
        ok: false,
        tool: name,
        ...meta,
        error: {
          code: "limit_exceeded",
          message: `Run time budget spent (${limit(ctx, "runBudgetMs") / 1000} s). Answer with the results you have.`,
          issues: [],
        },
        summary: "Error (limit_exceeded): run time budget spent",
      },
      rawInput,
    );
  }

  const parsed = TOOL_INPUT_SCHEMAS[name].safeParse(rawInput ?? {});
  if (!parsed.success) {
    return record(
      {
        ok: false,
        tool: name,
        ...meta,
        error: {
          code: "invalid_input",
          message: `Input does not match the ${name} schema`,
          issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`),
        },
        summary: "Error (invalid_input): schema validation failed",
      },
      rawInput,
    );
  }

  const handler = TOOL_HANDLERS[name] as (s: ToolSession, i: unknown) => ToolResult;
  return record(handler(session, parsed.data), parsed.data);
}
