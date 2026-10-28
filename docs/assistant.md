# Assistant: tools, provider adapter and guided demo mode

The assistant answers questions about the current demo session by calling deterministic
tools. It never calculates, never invents numbers and cannot send, pay, submit or approve
anything.

## Flow

```text
Browser (Assistant page)
  └─ snapshot of the in-memory session (revision, buffer, baseline, scenarios, drafts)
       └─ runAssistant server function (src/ai/assistant.functions.ts)
            ├─ validateAgentRequest: size, mode, question
            ├─ createToolSession: strict snapshot schema + dataset integrity → private copy
            ├─ live:   Lovable AI (AI SDK 7, Responses API) chooses tools → runTool
            └─ guided: fixed script → runTool
       ◄─ answer + trace + hypothetical changes + AgentRun
  └─ planAgentRunApply: apply only if the session revision is unchanged, else discard as stale
```

Nothing is stored on the server. Every request works on its own copy of the session it
sent, so no request can see or change another session.

## Tools

All inputs are strict Zod schemas (every property required, optional values `null`, no
extra properties). The same schema is sent to the model and checked again before any
handler runs. Semantic checks (real dates, amounts, ids) happen in the handlers.

| Tool | Kind | What it does |
| --- | --- | --- |
| `get_business_context` | read | Profile, opening balance, horizon, demo date, buffer, open receivables, active delay |
| `get_cash_events` | read | Events for `baseline` or `active_case`, with date/direction filters, at most 100 per call |
| `calculate_forecast` | read | `calculateDailyCashFlow` summary (optionally daily rows) |
| `simulate_payment_delay` | creates a hypothetical scenario | Same builder as the Overview control; idempotent; baseline unchanged |
| `compare_recovery_scenarios` | read | `compareRecoveryOptions` on the active delay; optional buffer for this call only |
| `prepare_action_draft` | creates an unsent draft | Letter built from the option terms by code; idempotent; never sent; refused for rejected options |
| `update_planning_constraints` | sets planning constraints | Minimum daily cash buffer; reject (with reason) or reinstate a recovery option. No money moves |
| `request_missing_information` | records a question | Marks the run "Needs your input" instead of guessing |

`simulate_payment_delay` takes exactly one of `delayDays` (counted from the original
expected date; the server computes the date) or `newDate`. Rejected options are not
evaluated by `compare_recovery_scenarios` (shown as unavailable with `rejectedByUser`).
When every evaluated option fails the buffer, the result carries finding `all_fail`,
the closest gap, and a note telling the model not to present any option as sufficient.

### Response envelope

Every result has `tool`, `datasetVersion`, `revision` (after any change it made) and a
deterministic `summary`. A success also has `sourceIds`, `assumptions`, `data` and
`mutation` (`null`, or `{ kind, id, change, hypothetical: true }`). A failure has
`error: { code, message, issues }`, where `code` is one of `invalid_input`, `not_found`,
`precondition_failed`, `calculation_error`, `limit_exceeded` or `unknown_tool`.

Amounts are returned as `{ bani, text }`. The model is told to quote `text` and never
compute.

## Trace

`runTool` writes one trace entry around each actual handler execution: tool name,
validated input (or the raw input when validation failed), success flag, summary,
error code and measured duration. Live and guided runs share this path, so the trace
cannot describe a call that did not happen. Model reasoning is requested only so the
model can work; it is not returned or shown.

## Untrusted data

Imported free text (event descriptions, counterparty names) is returned only under
`untrustedText`, with a `dataNotice`. The model instructions say tool results and
earlier answers are data and that instructions found in `untrustedText` must never be
followed. No tool can pay, send, submit or approve, so even a followed injection
could only create hypothetical records.

## Conversation

The browser keeps up to 20 turns (`DemoState.agentRuns`). Each request resends the
last 10 live turns as plain text (question + answer); tool calls are not replayed, so
every fact is re-read through tools. A turn whose revision is older than the session
is labelled "Older answer" in the UI and marked as such in the history sent to the
model. Replacing the dataset or Reset demo clears the conversation; "New conversation"
clears it on demand.

## Limits (`src/ai/tools/limits.ts`)

| Limit | Value |
| --- | --- |
| Request size (question + snapshot) | 512 KB |
| Question length | 1,000 characters |
| Tool calls per run | 8 executed, 3 refused (unknown tool or invalid arguments). When either is reached, tools are switched off for one final answer step and the loop stops |
| Conversation history | 10 turns, answers up to 6,000 characters |
| Run budget | 60 s, checked before each tool call and model step. An in-flight AI request is never aborted by a timer. |
| Model steps | 50 (safety ceiling) |
| Scenarios / drafts accepted in a snapshot | 20 / 50 |
| Events per `get_cash_events` call | 100 |

## Live mode (Lovable AI)

- Server-only module `src/ai/agent.server.ts`; `LOVABLE_API_KEY` is read inside the
  request from managed server-side secrets and never reaches the browser.
- Model `openai/gpt-6-astra` through the Lovable AI Gateway Responses API, using
  `@ai-sdk/openai` `.responses()`, `streamText` consumed on the server, `store: false`,
  low reasoning effort, `maxRetries: 0`.
- Failures are typed: `provider_timeout` (timeouts, 408/504), `provider_rate_limited`
  (429, with the Retry-After hint), `provider_malformed_response` (unparseable output,
  or a tool call after tools were switched off), `empty_response`, `provider_error`
  (others, e.g. 402 credits). No automatic retries. A failed run applies no changes;
  the question, conversation and data stay as they were. The error panel offers
  "Try again" and guided demo mode, and shows any tools that already ran.
- Refused calls (unknown tool, schema-invalid arguments) are caught by the SDK before
  execution, recorded as `rejectedToolCalls` and shown under the trace.

## Guided demo mode

A clearly labelled, deterministic fallback: "Guided demo mode (scripted sequence, not
live AI)". It ignores the question and always runs `get_business_context` →
`calculate_forecast(baseline)` → `simulate_payment_delay` (first open receivable +14 days,
skipped if a delay is already active) → `calculate_forecast(active_case)` →
`compare_recovery_scenarios`, then fills a fixed template from those results. It honours
the session's buffer and rejected options. No language model is involved.

## Applying results

The browser applies returned scenarios and drafts, then records the `AgentRun`, but only
if its revision and dataset version still match the snapshot. Otherwise the result is
shown as stale and not applied. Planning constraints come back as `changes.constraints`
and are applied before the turn is recorded.
