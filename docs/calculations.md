# Daily cash-flow calculation

Module: `src/domain/cash-flow.ts`. Pure TypeScript with integer bani. No LLM, network or storage is involved.

## Functions

- `calculateDailyCashFlow(request)`: the core calculation.
- `calculateDatasetCashFlow(dataset, today)`: runs the dataset integrity checks, then calculates from the dataset's cash events. Receivables are never summed.
- `parseRonToBani(text)`: converts a decimal RON string to bani by string parsing, never floating-point maths. Accepts up to two decimals; anything else is rejected rather than rounded.

## Request

| Field | Meaning |
| --- | --- |
| `currency` | Reporting currency. Only `RON` is supported. |
| `openingBalance` | `{ amount, currency, asOf }`. Balance at the **start** of `asOf`, which must equal `horizon.start`. It already includes all earlier history. |
| `horizon` | `{ start, end }`. Inclusive range of `YYYY-MM-DD` dates. |
| `events` | `{ id, date, direction, amount, currency, source?.documentNumber }`. `amount` is a positive integer in bani; `direction` gives the sign. |

## Result

- `days[]`: one row per date with `openingBalance`, `inflows`, `outflows` and `closingBalance`.
- `minimumClosingBalance` and `minimumClosingDate` (the first date the minimum occurs).
- `firstNegativeClosingDate`, or `null` if no day closes below zero.
- `shortfall` = max(0, −minimumClosingBalance).
- `endingBalance`: the closing balance on `horizon.end`.
- `includedEventIds` and `excludedEvents` (with reason `before_horizon` or `after_horizon`).
- `basis: "daily_closing_balance"`.

## Rules

- **Daily basis.** Events are aggregated per business date. The order of movements within a day is unknown, so the calculation makes no intraday liquidity claim. It reports closing balances only.
- **Outside the horizon.** Events before `horizon.start` are already in the opening balance; they are excluded and reported, never added. Events after `horizon.end` are excluded and reported.
- **Rejected with `CashFlowInputError`:**
  - non-integer, zero or negative amounts, or a fractional opening balance,
  - invalid dates, or a horizon whose start is after its end,
  - an opening balance not dated at the horizon start,
  - duplicate event IDs,
  - one document number on more than one event (that would double-count it).
- **Currencies.** An unsupported reporting currency, or any opening balance or event in a different currency, raises `UnsupportedCurrencyError`. Nothing is converted.

## Bucharest Cafe baseline (verified by tests)

Opening balance on 1 Nov: 12,000 RON. Closing balances for 1–10 Nov: 12,800 · 13,600 · 14,400 · 25,200 · 20,000 · 20,800 · 21,600 · 13,400 · 14,200 · **7,000**. The balance then stays flat at 7,000 to 30 Nov.

| Measure | Value |
| --- | --- |
| Minimum closing balance | 7,000 RON, first reached on 10 Nov |
| First negative day | none |
| Shortfall | 0 |
| Ending balance (30 Nov) | 7,000 RON |
