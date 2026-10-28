# Raiffeisen Finance Pilot — Project Brief

Raiffeisen Finance Pilot is a hackathon web application for small-business cash-flow planning and action preparation. The brand name **Raiffeisen Finance Pilot** is never translated or changed.

## Product loop

1. Load synthetic cafe data.
2. Calculate daily cash flow.
3. Introduce a delayed receivable.
4. Identify the resulting cash shortfall.
5. Compare feasible recovery scenarios.
6. Prepare an action draft.
7. Simulate acceptance or rejection of the draft.
8. Recalculate the forecast.

## Language contract

- English: all product UI, generated user-facing drafts, code comments, documentation, tests and pitch materials.
- Turkish: the assistant's explanations of work and blockers to the project owner (chat only).

## Working rules

- Work incrementally: implement only the numbered step the owner sends, then stop.
- Inspect existing work before changing it; do not rebuild working modules unnecessarily.
- Keep product scope small.
- Consult official documentation for any integration; never invent APIs.
- Maintain this file and `PROGRESS.md` in English.
- After each step, report in Turkish: what works, how to verify it, checks actually run, unresolved blockers.
- Never report an unexecuted test as passed.
- Save a recoverable checkpoint after each step when the environment supports it.
- Do not publish until the owner sends the publication step.

## Architecture contract

- Use the environment's supported stack (TanStack Start v1, React 19, Vite, Tailwind v4, TypeScript, Vitest).
- Typed domain contracts.
- A pure, independently testable financial calculation module with no UI, network or AI dependencies.
- Strict separation of three layers: UI, domain logic, AI/provider adapters.

## Financial rules

- All arithmetic runs in deterministic code, never in the LLM.
- Money is stored and computed as **integer bani** (100 bani = 1 RON). No floating-point money.
- Business dates are date-only strings in `YYYY-MM-DD` format.
- A **fixed demo clock** defines "today"; code never reads the real system date for business logic.

## Demo fixture

Bucharest Cafe, dataset `bucharest-cafe@1.0.0`. Full specification: [`docs/fixtures.md`](./docs/fixtures.md).

## Forecast states (must stay distinct)

| State | Meaning |
| --- | --- |
| Baseline | The original synthetic data; never mutated. |
| Hypothetical scenario | A "what if" projection; reversible and discardable. |
| Accepted forecast change | A plan the user accepted; changes the forecast, **not** cash on hand. |
| Actual payment | Cash that has actually moved. |

- Acceptance does not mean cash has arrived.
- Every forecast displays its assumptions.
- Baseline data is preserved; scenarios are reversible.

## AI boundaries

The AI may:
- select tools,
- request missing information,
- explain tool results,
- prepare drafts.

The AI must not invent rates, eligibility decisions, approvals, tool results or external actions.

## Safety rules

- Synthetic data only.
- No sending emails, initiating payments, submitting applications or connecting real bank accounts.
- Secret provider credentials live only in server-side secret storage — never in browser code, chat logs or client storage.
