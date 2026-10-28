# Bucharest Cafe fixture

Synthetic demo data only. Dataset version: **`bucharest-cafe@1.0.0`**.

| File | Purpose |
| --- | --- |
| `src/data/fixtures/bucharest-cafe.v1.json` | Full dataset; **single source of truth**. |
| `src/data/fixtures/bucharest-cafe.v1.cash-events.csv` | Cash events only, generated from the JSON. |

Both files can be downloaded from the Overview page. After editing the JSON, run `bun run fixtures:csv`; a test fails if the CSV and JSON differ.

## Profile

- Business: Bucharest Cafe (`biz-bucharest-cafe`)
- Currency: RON · Timezone: Europe/Bucharest
- Opening balance: 12,000.00 RON (1,200,000 bani) at the **start** of 2026-11-01. It already includes all historical transactions; historical rows are never added and the validator rejects events dated before 2026-11-01.
- Forecast horizon: 2026-11-01 to 2026-11-30 inclusive.
- Fixed demo date: 2026-11-01.

## Baseline cash events (all `forecast`, layer `baseline`)

| ID | Date | Direction | RON | Document |
| --- | --- | --- | ---: | --- |
| `evt-sales-2026-11-01` … `evt-sales-2026-11-10` | 1–10 Nov, daily | inflow | 800 each | — |
| `evt-cat-001` | 2026-11-04 | inflow | 10,000 | CAT-001 (receivable `rcv-cat-001`) |
| `evt-rent-2026-11` | 2026-11-05 | outflow | 6,000 | — |
| `evt-payroll-2026-11` | 2026-11-08 | outflow | 9,000 | — |
| `evt-sup-001` | 2026-11-10 | outflow | 8,000 | SUP-001 (supplier invoice) |

Totals: 18,000 RON in, 23,000 RON out, net −5,000 RON. No other events or charges.

**Simplifying demo assumption:** there are no sales after 10 November. This keeps the demo small and is not a realistic prediction.

Counterparty names are invented and prefixed "Synthetic".

## No double counting

Forecasts sum **cash events only**. Receivable `rcv-cat-001` is a document. It links to exactly one cash event (`cashEventId: evt-cat-001`), and that event points back to it (`source.kind = receivable`, `source.id = rcv-cat-001`). The validator rejects:

- a second cash event with the same document number,
- a receivable whose linked event is missing or differs in amount, currency or document number,
- a cash event that claims a receivable source no receivable links to.

## CSV columns

| Column | Type | Notes |
| --- | --- | --- |
| `id` | slug | Stable cash event ID |
| `date` | `YYYY-MM-DD` | Business date |
| `direction` | `inflow` \| `outflow` | Gives the sign |
| `amount_bani` | positive integer | 100 bani = 1 RON |
| `currency` | `RON` | |
| `category` | enum | `sales`, `receivable`, `supplier`, `payroll`, `rent`, `utilities`, `tax`, `financing`, `other` |
| `status` | `forecast` \| `actual` | `actual` means cash really moved |
| `layer` | `baseline` \| `scenario` \| `accepted` | |
| `description` | text | Quoted if it contains a comma, quote or newline |
| `counterparty` | text | Empty when none |
| `source_kind` | enum | `fixture`, `receivable`, `supplier_invoice`, `scenario`, `action_draft`, `agent_run`, `user` |
| `source_id` | slug | ID of the source record |
| `document_number` | text | Invoice number, e.g. `CAT-001`; empty when none |

Encoding: UTF-8, `\n` line endings, header row, trailing newline. Free-text cells starting with `=`, `+`, `-`, `@`, tab or CR are exported with a leading `'` (formula neutralisation). The import format is documented in [`csv-import.md`](./csv-import.md).
