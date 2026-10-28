/**
 * Request/response contract between the Assistant UI and the server function.
 * Client-safe: no secrets, no provider code.
 */
import type { AgentRun, AgentRunMode } from "@/domain";

import { AGENT_LIMITS } from "./tools/limits";
import type { RejectedToolCall, TraceEntry } from "./tools/runner";
import type { SessionChanges, SessionSnapshot } from "./tools/session";

export const GUIDED_MODE_LABEL = "Guided demo mode (scripted sequence, not live AI)";

/** One earlier live turn. Only text is resent; facts are always re-read through tools. */
export interface HistoryTurn {
  readonly question: string;
  readonly answer: string;
  /** Revision the turn's answer described. Older than the session = stale. */
  readonly endRevision: number;
}

export interface AgentRequestInput {
  readonly mode: AgentRunMode;
  readonly question: string;
  readonly history: readonly HistoryTurn[];
  readonly session: SessionSnapshot;
}

export const AGENT_ERROR_CODES = [
  "invalid_request",
  "request_too_large",
  "invalid_session",
  "provider_not_configured",
  "provider_timeout",
  "provider_rate_limited",
  "provider_malformed_response",
  "provider_error",
  "empty_response",
] as const;
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export interface AgentError {
  readonly code: AgentErrorCode;
  readonly message: string;
  /** Upstream HTTP status for provider errors, otherwise null. */
  readonly status: number | null;
  readonly issues: readonly string[];
  /** Seconds to wait before retrying (rate limits), when the provider said so. */
  readonly retryAfterSeconds?: number | null;
}

export type ValidatedAgentRequest =
  | {
      readonly ok: true;
      readonly mode: AgentRunMode;
      readonly question: string;
      readonly history: readonly HistoryTurn[];
      readonly session: unknown;
    }
  | { readonly ok: false; readonly mode: AgentRunMode; readonly error: AgentError };

export type AgentResponse =
  | {
      readonly ok: true;
      readonly mode: AgentRunMode;
      readonly answer: string;
      readonly trace: readonly TraceEntry[];
      readonly rejectedToolCalls: readonly RejectedToolCall[];
      /** Hypothetical scenarios, unsent drafts and planning constraints this run changed. */
      readonly changes: SessionChanges;
      /** Questions the assistant asked the user (request_missing_information). */
      readonly needsInput: readonly string[];
      readonly startRevision: number;
      readonly endRevision: number;
      readonly datasetVersion: string;
      readonly stoppedByLimit: boolean;
      readonly elapsedMs: number;
      readonly run: AgentRun;
    }
  | {
      readonly ok: false;
      readonly mode: AgentRunMode;
      readonly error: AgentError;
      /** Tool calls that did run before the failure. Their changes are discarded. */
      readonly trace: readonly TraceEntry[];
    };

const error = (
  code: AgentErrorCode,
  message: string,
  issues: readonly string[] = [],
): AgentError => ({
  code,
  message,
  status: null,
  issues,
});

function validateHistory(raw: unknown, issues: string[]): HistoryTurn[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    issues.push("history must be an array");
    return [];
  }
  if (raw.length > AGENT_LIMITS.maxHistoryTurns) {
    issues.push(`history has more than ${AGENT_LIMITS.maxHistoryTurns} turns`);
    return [];
  }
  const turns: HistoryTurn[] = [];
  raw.forEach((t: unknown, i) => {
    const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    const { question, answer, endRevision } = o;
    if (
      typeof question !== "string" ||
      typeof answer !== "string" ||
      typeof endRevision !== "number" ||
      !Number.isInteger(endRevision) ||
      endRevision < 0 ||
      Object.keys(o).some((k) => !["question", "answer", "endRevision"].includes(k))
    ) {
      issues.push(`history[${i}] must be { question, answer, endRevision }`);
      return;
    }
    if (question.length > AGENT_LIMITS.maxQuestionChars)
      issues.push(`history[${i}].question is too long`);
    if (answer.length > AGENT_LIMITS.maxHistoryAnswerChars)
      issues.push(`history[${i}].answer is too long`);
    turns.push({ question, answer, endRevision });
  });
  return turns;
}

/** Size and shape checks before anything else runs. Session contents are validated later. */
export function validateAgentRequest(raw: unknown): ValidatedAgentRequest {
  let bytes = Infinity;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(raw) ?? "").length;
  } catch {
    // unserialisable input stays at Infinity
  }
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode: AgentRunMode = obj["mode"] === "live" ? "live" : "guided";
  if (bytes > AGENT_LIMITS.maxRequestBytes) {
    return {
      ok: false,
      mode,
      error: error(
        "request_too_large",
        `Request is larger than ${AGENT_LIMITS.maxRequestBytes / 1024} KB`,
      ),
    };
  }
  const issues: string[] = [];
  if (obj["mode"] !== "live" && obj["mode"] !== "guided")
    issues.push('mode must be "live" or "guided"');
  const question = typeof obj["question"] === "string" ? obj["question"].trim() : null;
  if (question === null) issues.push("question must be a string");
  else if (question.length > AGENT_LIMITS.maxQuestionChars) {
    issues.push(`question is longer than ${AGENT_LIMITS.maxQuestionChars} characters`);
  } else if (obj["mode"] === "live" && question.length === 0) {
    issues.push("question is required in live mode");
  }
  const history = validateHistory(obj["history"], issues);
  if (!("session" in obj)) issues.push("session is required");
  if (issues.length)
    return {
      ok: false,
      mode,
      error: error("invalid_request", "Invalid assistant request", issues),
    };
  return { ok: true, mode, question: question!, history, session: obj["session"] };
}

/** Latest live turns as history (text only), trimmed to the request limits. */
export function historyFromRuns(runs: readonly AgentRun[]): HistoryTurn[] {
  return runs
    .filter((r) => r.mode === "live" && r.question.trim().length > 0)
    .slice(-AGENT_LIMITS.maxHistoryTurns)
    .map((r) => ({
      question: r.question.slice(0, AGENT_LIMITS.maxQuestionChars),
      answer: r.answer.slice(0, AGENT_LIMITS.maxHistoryAnswerChars),
      endRevision: r.endRevision,
    }));
}
