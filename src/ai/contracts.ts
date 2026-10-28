/**
 * AI integration contracts.
 *
 * The AI layer may only: select a tool, request missing information,
 * explain a tool result, or prepare a draft. It must never compute money,
 * invent rates, eligibility decisions, approvals, tool results or external actions.
 *
 * Validated persistence models (AgentRun, AgentStep, ActionDraft) live in the
 * domain module; this file re-exports the parts the AI layer needs.
 * The provider adapter (model calls, secrets) lives in the server-only
 * `agent.server.ts`; tool contracts live in `tools/`. This file is safe to import anywhere.
 */
import type { AgentToolName } from "@/domain";

export type { AgentRun, AgentStep, AgentToolName, ActionDraftStatus } from "@/domain";

/** The only kinds of output the AI layer is allowed to produce. */
export type AiOutput =
  | { readonly kind: "tool_request"; readonly tool: AgentToolName; readonly input: unknown }
  | { readonly kind: "missing_information"; readonly question: string }
  | { readonly kind: "explanation"; readonly text: string; readonly basedOnTool: AgentToolName }
  | { readonly kind: "draft"; readonly title: string; readonly body: string };
