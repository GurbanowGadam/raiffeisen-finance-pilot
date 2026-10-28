/**
 * Hard limits for assistant runs. Enforced in code (request validator and tool runner),
 * documented in docs/assistant-tools.md.
 */
export const AGENT_LIMITS = {
  /** Maximum serialized request size (question + session snapshot), in bytes. */
  maxRequestBytes: 512 * 1024,
  /** Maximum question length in characters. */
  maxQuestionChars: 1_000,
  /** Maximum tool calls per run. Further calls are refused and tools are switched off. */
  maxToolCalls: 8,
  /**
   * Ceiling on model steps in one run (AI SDK `isStepCount`). The effective bound is
   * maxToolCalls: once reached, tools are disabled and the next step must answer.
   */
  maxModelSteps: 50,
  /**
   * Wall-clock budget per run. After it is spent no new tool call starts and tools are
   * disabled for the next step. In-flight model calls are not aborted (platform guidance:
   * no artificial timeouts on AI calls).
   */
  runBudgetMs: 60_000,
  /** Maximum scenarios and action drafts accepted in a session snapshot. */
  maxScenarios: 20,
  maxActionDrafts: 50,
  /** Earlier conversation turns sent with a request, and their size. */
  maxHistoryTurns: 10,
  maxHistoryAnswerChars: 6_000,
  /** Refused model tool calls (unknown tool, invalid arguments) before tools are switched off. */
  maxRejectedToolCalls: 3,
  /** Maximum events returned by get_cash_events. */
  maxEventsPerCall: 100,
} as const;
