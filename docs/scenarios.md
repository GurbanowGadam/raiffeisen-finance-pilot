# Scenarios: Delay a payment

Code: `src/domain/scenarios.ts` (pure), `src/components/scenario/payment-delay-control.tsx`, `src/state/use-baseline-forecast.ts` (`useForecastView`).

## Rules

- A scenario stores **absolute** adjustments, for example `shift_event evt-cat-001 → 2026-11-18`. It is always applied to the original, frozen baseline, never to a previous scenario result. Re-applying it is idempotent, and changing the date replaces the old date instead of adding to it.
- The shifted receipt keeps its id, amount, document number and receivable link. No second copy is created; its layer becomes `scenario` (shown as "Hypothetical").
- Only one payment delay is active at a time (`scn-payment-delay`). **Update delay** replaces it; **Undo delay** removes it.
- A valid new date is a real `YYYY-MM-DD` date, later than the baseline date and not before the demo date.
- A date after the forecast horizon is allowed. The receipt is then excluded from the forecast and reported as `after_horizon`, and the UI says so.
- The baseline is never modified. The dashboard shows the delayed case and the baseline side by side: KPI "Baseline:" lines, a dashed baseline line in the chart, and a baseline column in the daily table.
- **Data revision:** `DemoState.revision` increases on every data change (reset, import, scenario upsert or undo). Re-submitting an identical scenario changes nothing.
  - Forecasts and recommendations are recomputed per revision; the banner shows "Recalculated for data revision N".
  - Agent runs are cleared on every scenario change, because their advice used older data.

## Verified delayed case (CAT-001: 4 Nov → 18 Nov)

| Date | Closing balance |
| --- | ---: |
| 4 Nov | 15,200 RON |
| 8 Nov | 3,400 RON |
| 10 Nov | **−3,000 RON** (first negative day, minimum) |
| 11–17 Nov | −3,000 RON |
| 18 Nov | **7,000 RON** (recovery) |
| 30 Nov | **7,000 RON** |

The shortfall of 3,000 RON is temporary: it lasts from 10 to 17 November even though the month ends positive.

If CAT-001 moves to 2026-12-05 (outside the horizon), the balance stays at −3,000 RON until 30 November and does not recover within the horizon.
