# FinansalPilot — Progress

Legend: `[x]` done and verified · `[ ]` not started or not verified.

Step titles after Step 1 are provisional and follow the product loop in `PROJECT_BRIEF.md`. They will be replaced with the owner's wording when each step is sent.

## Step 0 — Contract and environment inspection

- [x] Contract recorded in `PROJECT_BRIEF.md`; architecture rules in `AGENTS.md`.
- [x] Environment inspected (TanStack Start v1, React 19, Vite, Tailwind v4, Vitest 4, Bun).

## Step 1 — Minimal runnable application shell

- [x] App shell with Overview (`/`), Transactions, Scenarios and Actions navigation (desktop sidebar, mobile tab row).
- [x] Visible "Synthetic demo data" label in the header of every page.
- [x] Fixed demo clock shown in the shell (was `2026-11-02`; changed to `2026-11-01` in Step 2).
- [x] Separate modules: `src/domain` (types, money, dates, calculations), `src/data` (adapter contract + synthetic cafe stub), `src/ai` (AI output contracts only).
- [x] Unit tests for integer-bani helpers, business dates, net calculation and the synthetic adapter; routing tests for all four pages.
- [x] README documents how to start, test, lint and build.
- No authentication, payments or database added; none is required yet.

Checks run in Step 1: see "Verification log" below.

## Step 2 — Validated domain models and Bucharest Cafe fixture

- [x] Zod-validated models with inferred types (`src/domain/models.ts`): BusinessProfile, CashEvent, Receivable, Scenario, ActionDraft, AgentRun, plus DemoDataset. Stable slug IDs, currency, source references (`source` with document number) and event status (`forecast` / `actual`) and layer (`baseline` / `scenario` / `accepted`).
- [x] Integrity rules (`src/domain/integrity.ts`): an invoice and its linked cash event cannot be counted twice (one cash event per document number, 1:1 receivable ↔ cash event link with matching amount); no historical rows before the opening balance; no future `actual` payments.
- [x] Fixture `bucharest-cafe@1.0.0` (JSON source of truth + generated CSV), documented in `docs/fixtures.md`, downloadable from Overview.
- [x] Missing post-10-November sales labelled as a simplifying demo assumption.
- [x] Reset demo button: clears scenarios, action drafts and agent runs and reloads exactly the fixture baseline. Baseline is deep-frozen.
- [x] Fixed demo date moved to `2026-11-01` (horizon start) so every fixture event is a future forecast.
- Note: the Reset action is verified by unit tests. No UI can create scenarios or drafts yet, so in the browser Reset was only checked on the empty state.

## Step 3 — Daily cash-flow calculation engine

- [x] Pure `calculateDailyCashFlow` (`src/domain/cash-flow.ts`) returns, per day, the opening balance, inflows, outflows and closing balance, plus the minimum closing balance and its first date, the first negative date, the shortfall max(0, -min) and the ending balance. Basis: daily closing balances only.
- [x] Events are aggregated by business date. Events outside the horizon are excluded and reported; earlier ones are treated as already included in the opening balance.
- [x] Rejects invalid amounts, dates, horizons, duplicate IDs and duplicate document numbers. Rejects unsupported or mismatched currencies (no conversion).
- [x] `calculateDatasetCashFlow` runs integrity checks first and sums cash events only (receivables are never added).
- [x] `parseRonToBani` converts decimal RON strings exactly.
- [x] Documented in `docs/calculations.md`.
- Baseline verified: 10 Nov close = 7,000 RON; 30 Nov ending = 7,000 RON; minimum 7,000 RON first on 10 Nov; no negative day.
- No UI change in this step (the forecast view is Step 4).

## Step 4 — Overview dashboard connected to the calculation

- [x] Overview runs `calculateDatasetCashFlow` on the current baseline through `useBaselineForecast`. No LLM is involved, and every number on screen comes from domain code.
- [x] Status banner: states the business problem (shortfall or none) and the next action. It names the lowest-day outflow (SUP-001) and the open receivable to stress-test (CAT-001), and links to Scenarios.
- [x] Opening cash (badge "Known", solid card) is visually separated from the projected figures (dashed teal panel, badge "Forecast, not cash in bank"): lowest projected cash, first projected shortfall date and projected cash at horizon end.
- [x] Daily closing-balance chart: dates, RON axis with round ticks, dashed 0 RON line, lowest-point marker, red line/fill and dots below zero, a tooltip with exact RON, and an expandable daily figures table as the text alternative.
- [x] Upcoming cash events: table on laptop/desktop, stacked list on phone/tablet, with source (e.g. "Customer invoice CAT-001"), status (Forecast/Actual payment) and layer labels.
- [x] States: skeleton while the chart loads in the browser; error panel listing validation issues (no figures guessed); empty events message.
- [x] Assumptions and fixture downloads kept below.
- [x] Navy/teal/amber tokens; all main text pairs measured at WCAG AA (lowest 5.15:1).
- Not visually verified: the negative-balance highlighting in the browser. The baseline has no negative day and no screen can create one yet; the colour-split logic is covered by unit tests. Dark mode is not used.

## Step 5 — CSV import of cash events

- [x] Transactions page: active dataset summary (source, version, events, opening balance, horizon), Export active CSV, the import panel, and the full events table with source/status/layer labels.
- [x] Import settings: opening balance (decimal RON), forecast start and end.
- [x] Validation of headers, IDs, dates, the RON-only currency, positive amounts and direction; also category, status, layer, text length, control characters and document numbers. Row-specific errors show line numbers.
- [x] Preview before applying, including the resulting forecast. Apply is disabled while any error exists.
- [x] Confirming replaces the active dataset (never appends), recalculates the dashboard, and discards stale scenarios, action drafts and agent runs. Cancel or a failed import leaves the dataset unchanged.
- [x] Two downloadable samples (amount_bani fixture, amount_ron decimal example). Format, decimal rules and limits are documented in `docs/csv-import.md`.
- [x] Limits: 256 KB, 2,000 rows, 366-day horizon, 200-character text fields.
- [x] Escaping: imported text renders as React text; exported free-text cells are formula-neutralised with a leading `'`, which the importer reverses.
- PDF/OCR not implemented (out of scope for this step).
- Note: native date pickers show the browser's local display format (e.g. 11/01/2026), but always submit `YYYY-MM-DD`.

## Step 6 — Delay a payment (delayed receivable)

- [x] "Delay a payment" control on Overview: pick an open receivable (CAT-001) and a new expected date (default 18 Nov), then Apply / Update delay, or Undo delay.
- [x] Pure domain scenario (`src/domain/scenarios.ts`): an absolute `shift_event`, always applied to the frozen baseline. Same id, amount and document; no second copy; layer `scenario`.
- [x] Baseline preserved. The dashboard shows the delayed case against the baseline: banner, KPIs with "Baseline:" lines, chart with a dashed baseline line, daily table with a baseline column, and events marked "moved from 4 Nov".
- [x] Delayed-case results verified: 10 Nov close −3,000 RON; first negative 10 Nov; minimum −3,000 RON; 18 Nov close 7,000 RON; 30 Nov ending 7,000 RON. The banner states the shortfall is temporary (10–17 Nov) despite the positive month end.
- [x] Repeated clicks: identical scenario, no state change, no duplicate event, no compounding. A different date replaces the old one. A date after the horizon is excluded and explained.
- [x] Data revision counter. Forecasts and recommendations recompute per revision; scenario changes clear agent runs. `DEMO_STATE_VERSION` bumped to 3.
- Documented in `docs/scenarios.md`.

## Step 7 — Recovery scenarios A/B/C

- [x] Three independent recovery options built on the delayed case and never combined: A partial collection, B supplier deferral, C fictional financing. Terms are validated synthetic data in `src/data/recovery-terms.ts`.
- [x] Explicit `split_event` with amount conservation. The double-count guard allows a shared invoice number only across the complete parts of one split.
- [x] Verified: A lowest 1,000 / ending 7,000 RON; B lowest 1,000 / ending 7,000 RON; C lowest 400 / ending 6,900 RON. The 10,000 RON receivable and the 8,000 RON supplier payment are conserved.
- [x] Each card shows upfront conditions, explicit costs (B's 0 RON fee labelled demo-only; C's 100 RON fee), lowest and ending cash, unresolved approvals (A/B counterparty, C bank; all "Not requested"), disclosures, and a "Hypothetical" badge.
- [x] Configurable minimum cash buffer (default 0 RON), with pass/fail and gap per option. The `all_fail` finding is reported without inventing a solution.
- [x] Option events after the horizon are excluded and disclosed. Options with missing invoices are marked unavailable with a reason.
- [x] All options are computed together from one data revision (shown on the page). `DEMO_STATE_VERSION` bumped to 4 (cash buffer).
- No LLM involved. Documented in `docs/recovery.md`.

## Step 8 — Validated AI tools, server handlers and guided demo mode

- [x] Six tools with strict Zod input schemas and server-side handlers (`src/ai/tools/`): `get_business_context`, `get_cash_events`, `calculate_forecast`, `simulate_payment_delay`, `compare_recovery_scenarios`, `prepare_action_draft`. They reuse the domain calculations, scenario builder and recovery comparison.
- [x] Uniform envelope: dataset version, revision, source IDs, assumptions, and a structured error (`code`, `message`, `issues`). Amounts are returned as exact bani plus formatted text.
- [x] Isolated session: each request sends a snapshot that is validated (strict schema plus dataset integrity). Tools work on a private copy. Mutating tools only create a hypothetical scenario or an unsent draft. The browser applies them only if its revision is unchanged; otherwise they are discarded as stale.
- [x] Provider adapter: Lovable AI Gateway (`openai/gpt-6-astra`, Responses API, AI SDK 7) in server-only `src/ai/agent.server.ts`. `LOVABLE_API_KEY` was already in managed secrets, so no configuration was needed from the owner.
- [x] Real tool trace recorded around each handler execution (tool, validated input, summary, duration, error code); no model reasoning is shown.
- [x] Guided demo mode: a deterministic scripted sequence using the same tools, labelled "not live AI". It is offered automatically when live AI fails.
- [x] Limits: 512 KB request, 1,000-character question, 8 tool calls, 60 s run budget (checked between steps, no timer aborts), 50 model steps, 100 events per call.
- [x] Assistant page (`/assistant`) with mode choice, answer, trace, and error/stale/empty states. The Actions page lists drafts marked "Draft · not sent".
- [x] Revision changes, including buffer changes, now clear recorded answers.
- Documented in `docs/assistant.md`. No multi-agent system.

## Step 9 — Live LLM agent with a bounded tool loop

- [x] Lovable AI (`openai/gpt-6-astra`, Responses API) drives the Step 8 tools in a bounded loop. It allows 8 executed calls and 3 refused calls, and checks a 60 s run budget between steps. Once a budget is spent, tools are switched off for exactly one final answer step and the loop stops.
- [x] Multi-turn conversation: the last 10 live turns are resent as text. Facts are always re-read through tools. Turns are kept in the session (up to 20) and labelled "Older answer" once the data revision moves on. The newest turn is stamped with the browser's revision.
- [x] New tools: `update_planning_constraints` (minimum daily cash buffer, refused or reinstated recovery options) and `request_missing_information` (run marked "Needs your input"). `simulate_payment_delay` accepts `delayDays`, so the server computes "14 days late"; the model never does date arithmetic.
- [x] Rejected options are excluded from comparisons everywhere (domain `compareRecoveryOptions`, the Scenarios page and the tools) and cannot be drafted. At a 2,000 RON buffer all three default options fail (closest gap 1,000 RON). The tool tells the model not to present any option as sufficient.
- [x] Untrusted data: imported descriptions and counterparty names are returned under `untrustedText` with a notice. The instructions forbid following instructions found in data.
- [x] Authority: there are no payment, send, submit or approve tools. Unknown tools and schema-invalid arguments are refused before execution and listed as "Refused tool calls".
- [x] Failures: timeout, rate limit (with retry hint), malformed response, empty answer and other provider errors are typed. A failed run applies no changes; the question, conversation and data are kept. The error panel offers "Try again" and "Use guided demo mode instead".
- [x] UI: conversation thread with a concise answer, sources (cash events with date and amount, receivables, scenarios, options), assumptions, the real tool trace and refused calls; a planning constraints bar with "Clear constraints"; "New conversation". Simple Markdown tables in answers are rendered.
- [x] Live integration verified (see log). Not a release blocker for the AI-agent claim.
- Documented in `docs/assistant.md`.

## Step 10 — Action drafts, simulated responses and accepted changes

- [x] Drafts built by pure domain code (`src/domain/action-drafts.ts`) from the current comparison:
  - A: editable English email for CAT-001 asking for 4,000 RON by 9 Nov with the remaining 6,000 RON expected on 18 Nov.
  - B: editable supplier request for SUP-001.
  - C: a Markdown bank-meeting brief covering the gap, dates, source events, alternatives and fictional-product assumptions.
  The UI ("Prepare a draft") and the assistant's `prepare_action_draft` use the same builder.
- [x] States: Draft, Awaiting response, Accepted, Rejected. Each change is recorded in the audit history with a wall-clock timestamp, the demo date and the session revision. Every draft also records its source dataset version and revision.
- [x] Clearly labelled "Simulate acceptance" and "Simulate rejection" in a "Simulation only: nothing is sent, paid or submitted" box. There is also an optional "Mark as awaiting response" for drafts the user sends themselves.
- [x] Acceptance appends one audit-trailed accepted change and updates the active forecast exactly once; a repeat changes nothing.
  - The baseline, the opening (actual) cash, the forecast status of events and the open status of receivables are unchanged.
  - Accepted events are labelled "Accepted change".
  - Overview shows "Includes N accepted proposals (simulated)".
- [x] Rejection leaves the forecast unchanged and excludes the option. The rejected card links to the assistant with a pre-filled "which remaining options still work?" question. The assistant's comparison then lists only the remaining options.
- [x] Stale drafts: a draft whose proposal or quoted figures no longer match the current data (or that belongs to another dataset version) is marked "Outdated draft". Acceptance and marking as sent are blocked until "Regenerate draft"; history is kept. A data change that does not alter the draft only shows a "re-checked" note.
- [x] Copy the email or brief to the clipboard; download the brief as Markdown or plain text.
- [x] The Scenarios page compares remaining options on the active case and shows accepted options as accepted. `DEMO_STATE_VERSION` was bumped to 6.
- Documented in `docs/actions.md`. There is no "undo acceptance" control yet; Reset demo removes accepted changes.

## Owner request (outside the numbered steps) — Guided 1-2-3 flow and simpler CSV

- [x] Navigation split into "Steps" (1 Overview, 2 Scenarios, 3 Actions) and "Tools" (Transactions, Assistant); a progress bar ("See the problem / Pick a fix / Prepare the message") and a "Next" button on each step page. Progress is derived from state only (delay applied, draft exists, change accepted).
- [x] Overview: status, delay control, figures and chart stay visible; daily table, upcoming events and data assumptions moved into a collapsed "More details" section.
- [x] Scenarios: compact A/B/C cards (lowest cash, ending cash, cost, approval, draft button); conditions/assumptions and the side-by-side table are collapsed by default; buffer setting is one inline row.
- [x] Transactions: three-part import (download sample, settings + file, preview then replace); full format and limits collapsed; event table collapsed.
- [x] New simple sample `bucharest-cafe-simple.csv` (10 columns, amounts in RON) whose forecast equals the built-in fixture.
- No calculation, scenario, import-validation or acceptance rule was changed.

## Step 11 — AI assistant integration (tool selection, explanations, drafts)

- [ ] Not started. The Lovable AI provider adapter and tools exist since Step 8; no Lovable Cloud database was needed.

## Step 12 — Simulated acceptance / rejection and recalculation (provisional title)

- [ ] Not started. Simulated acceptance/rejection was delivered in Step 10; this title will be replaced when the step is sent.

## Step 13 — End-to-end hardening and tests

- [ ] Not started.

## Step 14 — Pitch materials and publication

- [ ] Not started. Publishing only on the owner's explicit publication step.

## Verification log

### Step 1 (2026-10-28)
- `bunx vitest run`: 2 files, 14 tests passed.
- `bunx eslint` on all files touched in Step 1: clean after one Prettier formatting fix.
- Platform preview build (automatic): build OK.
- Headless browser (Playwright) at 1280px and 390px: all four nav links navigate to the correct page and title; "Synthetic demo data" label visible; no page errors.
- Not run manually: `bun run build` and a full-project `tsc --noEmit` (the platform runs the build itself).

### Step 2 (2026-10-28)
- `bunx vitest run`: 5 files, 38 tests passed (models, integrity, fixture values, CSV = JSON, reset, routing).
- `bunx tsc --noEmit`: no errors.
- `bunx eslint src scripts`: 0 errors.
- Headless browser: Overview shows Bucharest Cafe, 12,000.00 RON at start of 2026-11-01, horizon, 14 events and dataset version; both downloads return the fixture (JSON 14 events, CSV 14 rows); Reset demo shows its confirmation; no console errors.
- Fix: a hot-reload crash ("useDemoState must be used inside DemoStoreProvider") was fixed by moving the store contexts into `src/state/demo-context.ts`. Re-verified afterwards: 38 tests pass and the browser check is clean.

### Step 3 (2026-10-28)
- `bunx vitest run`: 6 files, 86 tests passed (48 new in `src/domain/cash-flow.test.ts`).
- `bunx tsc --noEmit`: no errors.
- `bunx eslint src/domain`: no errors or warnings.

### Step 4 (2026-10-28)
- `bunx vitest run`: 7 files, 99 tests passed (13 new: chart model incl. negative split and round ticks, forecast summary, formatters, source labels).
- `bunx tsc --noEmit`: no errors. `bunx eslint src`: 0 errors.
- Headless browser at 390, 768, 1024 and 1280 px: no horizontal overflow, no console errors; zero line and lowest marker present; tooltip shows "Mon 9 Nov 2026 · 14,200.00 RON"; daily table shows 30 rows. Two layout issues found and fixed during the check (tablet table overflow, wrapped projected values).
- Contrast computed from tokens: all checked pairs >= 5.15:1.
- Fix after Step 4: a stale-tab crash ("Cannot read properties of null (reading 'useMemo')") happened when Vite discovered `recharts` mid-session and re-optimised dependencies. Fixed by pre-bundling `recharts`, `zod`, `sonner`, `lucide-react` and `@radix-ui/react-slot` in `vite.config.ts`. Re-verified: the dev server restarted cleanly, a fresh browser load has no errors, and 99 tests pass.

### Step 5 (2026-10-28)
- `bunx vitest run`: 9 files, 140 tests passed (41 new). Covered: valid import (the fixture CSV reproduces the baseline exactly), malformed date, missing header, duplicate ID, cancelled import (panel rendered with React Testing Library), failed import, replace-not-append, HTML escaping, formula escaping round trip, limits, CSV syntax, and the store's invalidation and reset.
- `bunx tsc --noEmit`: no errors. `bunx eslint src`: 0 errors.
- Headless browser (1280 px and 390 px): bad file shows 2 row errors with Apply disabled; cancel keeps the fixture (14 events); importing a file with payroll at 20,000 RON replaced the dataset; export downloaded 14 rows. Overview then showed "Cash is projected to run out on Tue 10 Nov 2026" with the red below-zero chart highlighting (21 negative-day markers), which completes the visual check left open in Step 4. One phone layout issue was found and fixed (row errors off-screen, clipped button). No console errors.
- Fix after Step 5: a hot-reload crash ("Cannot read properties of undefined (reading 'kind')") happened because the open tab kept store state from before `activeSource` existed. The store now carries `DEMO_STATE_VERSION`, and the provider replaces older-shaped state with a fresh baseline. Re-verified: 141 tests pass, and the full import flow plus a fresh load run with no console errors.

### Step 6 (2026-10-28)
- `bunx vitest run`: 10 files, 165 tests passed (24 new in `src/domain/scenarios.test.ts`). Covered: expected delayed results, repeat clicks (builder, apply, three reducer dispatches), a different date, outside-horizon receipt, validation, stale dataset version, undo, and revision/agent-run invalidation.
- `bunx tsc --noEmit`: no errors. `bunx eslint src`: 0 errors.
- Headless browser (1280 px and 390 px): default date 2026-11-18. After Apply, the banner showed the temporary shortfall 10–17 Nov with recovery on 18 Nov; KPIs showed −3,000 RON with "Baseline: 7,000.00 RON"; the chart drew the dashed baseline line with 8 negative-day markers. Three more clicks left 14 events and revision 1. Moving to 2026-12-05 showed "Not temporary" plus the outside-horizon note. 2026-11-03 was rejected. Undo returned to the baseline. No horizontal overflow, no console errors.

### Step 7 (2026-10-28)
- `bunx vitest run`: 11 files, 189 tests passed (24 new: 23 in `src/domain/recovery.test.ts` and 1 buffer-state test). Covered: the expected A/B/C results, conservation, costs and approvals, independence, same basis, buffers of 0/1,000/1,500 RON and below the delayed minimum, outside-horizon disclosures (delay to 5 Dec; 15 Nov horizon), unavailable options, bad split, unsplit duplicate invoice.
- `bunx tsc --noEmit`: no errors. `bunx eslint src`: 0 errors.
- Headless browser (1280 px and 390 px): starting from the delayed case showed A 1,000/7,000, B 1,000/7,000 and C 400/6,900 RON. The finding read 3/3 at 0 RON, 2/3 at 1,000 RON (C "Fails buffer by 600.00 RON"), and "No evaluated option…" at 1,500 RON (closest 500 RON short). A negative buffer was rejected, and the buffer was kept across page navigation. One desktop layout issue was found and fixed (figures colliding inside cards, squeezed buffer hint). No horizontal overflow, no console errors.

### Step 8 (2026-10-28)
- Installed `ai@7.0.154` and `@ai-sdk/openai@4.0.103`. The newest patch versions were refused by the package manager's 24-hour minimum release age.
- `bunx vitest run`: 13 files, 232 tests passed (43 new in `src/ai/tools/tools.test.ts` and `src/ai/agent.test.ts`). Covered: strict JSON schema for every tool, the envelope, each handler (expected baseline, delayed and A/B/C figures; filters; idempotent delay and drafts; not-found, invalid and precondition errors), runner validation, the unknown tool, call-count and runtime limits, session isolation, tampered or oversized snapshots, request size and question checks, guided-mode determinism and labelling, applying vs stale results, revision invalidation, and live mode without a key.
- `bunx tsgo --noEmit`: no errors. `bunx eslint` on changed folders: 0 errors.
- Live Lovable AI call (server-side script and browser): the model called `simulate_payment_delay`, `compare_recovery_scenarios` and `prepare_action_draft` by itself. Every amount in the answer matched the tool output (−3,000 / 1,000 / 7,000 / 400 / 6,900 RON). The changes came back as one hypothetical scenario and one unsent draft. About 10 s per run.
- Headless browser (1280 px and 390 px): the guided run showed the "not live AI" badge, 5 trace entries, and the delay on Overview; the live run showed the "Live AI" badge, the trace, and a draft on Actions. No horizontal page overflow, no console errors. On phones the tab row scrolls sideways to reach Actions.
- Not tested live: provider error responses (402/429/5xx). The error path is unit-tested only for a missing key.

### Fix after Step 8 (2026-10-28)
- Blank preview ("Cannot read properties of null (reading 'useContext')"). Cause: the Assistant page's server-function call first imported `@tanstack/router-core` subpaths and `seroval`, so Vite re-optimised mid-session and the open tab had two React copies. Fixed by pre-bundling them (and `@radix-ui/react-label`) in `vite.config.ts`. Re-verified: a fresh browser session over all pages plus a server-function call triggered no new optimisation and no console errors.

### Step 9 (2026-10-28)
- `bunx vitest run`: 14 files, 254 tests passed. 20 are new in `src/ai/agent-loop.test.ts`; they drive the real loop with the AI SDK mock model. They cover the three example conversations, delay-input validation, refused-option drafting, missing information, tool authority, unknown or invalid tool calls, the loop bound (including a model that ignores tools-off), rate limit/timeout/malformed/mid-run failure, untrusted imported text, history labelling and validation, and conversation state. Existing tests were updated for the new tool inputs and for stale-labelling (answers are kept instead of being wiped).
- `bunx tsgo --noEmit`: no errors. `bunx eslint` on changed folders: 0 errors.
- Live integration check (real Lovable AI, server-side script, the three example messages as one conversation; about 6 s per turn):
  1. "14 days late": the model called `get_business_context` and then `simulate_payment_delay` (delayDays 14), moving CAT-001 to 2026-11-18. The answer gave the lowest balance −3,000 RON on 10 Nov, recovery on 18 Nov and 7,000 RON at month end.
  2. "Supplier refused": the model called `update_planning_constraints` (reject B) and `compare_recovery_scenarios`. A (1,000 RON) and C (400 RON) remain; B was not recommended.
  3. "At least 2000 RON": the model called `update_planning_constraints` (buffer 2,000) and compare. The answer said "No evaluated option meets your requirement" with gaps of 1,000 and 1,600 RON, then asked whether to change a constraint.
- Headless browser: the same three questions in the UI showed earlier turns marked stale, the constraints bar (2,000 RON; B rejected) and the table rendered. Scenarios showed B "Rejected" and the all-fail finding at 2,000 RON. Guided mode then honoured the constraints and kept its "not live AI" label. At 390 px there was no horizontal overflow and no console errors.
- Not verified against the real provider: 429/timeout/malformed responses (covered by mock-model tests only).

### Step 10 (2026-10-28)
- `bunx vitest run`: 15 files, 272 tests passed. 18 are new in `src/state/actions.test.ts`; they cover A/B/C draft content, plain-text brief conversion, acceptance (forecast once; baseline, opening cash, receivable and forecast status unchanged; audit fields), duplicate acceptance, acceptance from Awaiting response, comparison on the active case, combined A+B, rejection (forecast unchanged, option excluded, assistant reconsiders), stale drafts (moved delay, changed brief figures, other dataset version), re-checked drafts, import/reset clearing, editing rules, and agent/UI draft parity. Existing tests were updated for the new draft model and wording.
- `bunx tsgo --noEmit`: no errors. `bunx eslint src`: 0 errors.
- Headless browser (1280 px and 390 px), sequence and results:
  1. Applied the delay and generated drafts A, B and C. The A text was verified and "Copy email" filled the clipboard.
  2. Moved the delay to 20 Nov. A showed "Outdated draft" with acceptance disabled. "Regenerate draft" produced 20 Nov.
  3. Simulated acceptance of A: status Accepted (simulated), no further accept button, and an audit trail entry with timestamp and revisions.
  4. Simulated rejection of B: Rejected, with the assistant link (the question arrived pre-filled).
  5. The brief C became outdated after A's acceptance and was regenerated.
  6. Markdown and plain-text downloads were saved (the plain text has no Markdown syntax).
  7. Overview showed the accepted banner, opening cash 12,000 RON (Known) and lowest 1,000 RON in the active case.
  One phone overflow was found and fixed (497 → 390 px). No console errors.
- Not done: no live LLM call in this step (the assistant changes are covered by tool tests).


### Guided 1-2-3 flow and simple CSV (owner request, 2026-10-28)
- `bunx vitest run`: 17 files, 279 tests passed (7 new: simple CSV imports with 0 errors and gives the same daily forecast as the fixture; flow progress derivation).
- `bunx tsgo --noEmit -p .`: no errors. `bunx eslint src`: 0 errors (fast-refresh warnings only).
- Headless browser at 957×745, 1280×1800 and 390×844: Overview → Apply delay → Next → Scenarios → Draft customer email → Next → Actions, then Transactions import of the simple CSV → Overview lowest 7,000 RON. No horizontal overflow and no console errors. Fixed during the check: overlapping amounts in the three-column option cards and a full-width download button.

### Git ignore configuration (owner request, 2026-10-28)

- Expanded `.gitignore` for environment secrets, private keys, local AWS/Codex settings, dependencies, build output, caches, test reports and temporary files.
- Environment examples, `bun.lock`, source code, synthetic fixtures and Lovable project metadata remain eligible for version control.
- Verification: `git check-ignore --no-index` confirmed 40 ignored paths and 18 preserved paths; no tracked files match the ignore rules. Application tests were not run because only ignore rules and this log changed.
