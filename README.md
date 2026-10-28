# Raiffeisen Finance Pilot

Cash-flow planning and action preparation for small businesses. Hackathon project; uses **synthetic demo data only**.

- Product contract: [`PROJECT_BRIEF.md`](./PROJECT_BRIEF.md)
- Step-by-step status: [`PROGRESS.md`](./PROGRESS.md)
- Architecture rules: [`AGENTS.md`](./AGENTS.md)

## Requirements

- Node.js 22+ and [Bun](https://bun.sh) (npm also works).

## Start the app

```sh
bun install
bun run dev
```

The dev server prints the local URL (port 8080 in the Lovable sandbox). The Overview dashboard at `/` is the entry point.

## Run checks

```sh
bun run test     # Vitest unit and routing tests
bun run lint     # ESLint + Prettier
bunx tsc --noEmit  # TypeScript type check
bun run fixtures:csv  # regenerate the CSV fixture from the JSON fixture
```

## Live AI

The Assistant's live mode uses Lovable AI through the server-side `LOVABLE_API_KEY` secret, which Lovable manages. Running elsewhere without that secret, live mode reports "not configured" and guided demo mode still works.

## Build

```sh
bun run build    # production build (edge / Cloudflare Workers target)
bun run preview  # serve the production build locally
```

## Project layout

| Path | Responsibility |
| --- | --- |
| `src/domain/` | Pure domain: Zod-validated models, integrity rules, integer-bani money, `YYYY-MM-DD` dates, fixed demo clock, calculations. No UI, network, storage or AI imports. |
| `src/data/` | Data adapters and fixtures (`fixtures/bucharest-cafe.v1.*`, see [`docs/fixtures.md`](./docs/fixtures.md)). Only synthetic sources. |
| `src/components/import/` | CSV import panel and preview (format: [`docs/csv-import.md`](./docs/csv-import.md)). |
| `src/components/scenario/` | Delay a payment control (rules: [`docs/scenarios.md`](./docs/scenarios.md)). |
| `src/components/recovery/` | Recovery option cards and buffer control (rules: [`docs/recovery.md`](./docs/recovery.md)). |
| `src/state/` | In-memory demo session (baseline + scenarios, drafts, agent runs) and the Reset demo action. |
| `src/ai/` | Assistant: tool schemas, handlers, runner and limits (`tools/`), guided demo, server-only Lovable AI adapter (`agent.server.ts`), server function (`assistant.functions.ts`). See [`docs/assistant.md`](./docs/assistant.md). |
| `src/components/assistant/` | Assistant page panel, answer rendering and tool trace. |
| `src/components/actions/` | Draft cards: editing, copy/download, simulated responses, history (rules: [`docs/actions.md`](./docs/actions.md)). |
| `src/components/` | Shared UI (app shell, page header). |
| `src/routes/` | Pages: Overview (`/`), Transactions, Scenarios, Assistant, Actions. |

## Built with

TanStack Start, React, TypeScript, Tailwind CSS, Vitest.
