# Recovery options (Step 7)

Code:
- `src/domain/recovery.ts`: pure builder and comparison.
- `src/data/recovery-terms.ts`: synthetic demo terms, validated by `recoveryTermsSchema`.
- `src/routes/scenarios.tsx` and `src/components/recovery/`: the page.

## Principles

- **Based on the delayed case.** Each option is the active payment delay plus that option's own adjustments. Without a delay, the page offers to start from CAT-001 on 18 Nov.
- **Independent, never combined.** Each option is its own scenario.
- **Same basis.** All options are computed in one pass from the same data revision, dataset version, delay scenario and buffer. The page shows "computed together from data revision N".
- **Hypothetical until approved.** Every option needs acceptance or approval. Every approval shows "Not requested"; nothing is assumed accepted.
- **Deterministic numbers only.** Lowest and ending cash come from `calculateDailyCashFlow` (daily closing balances).
- **No invented solution.** If every option fails the buffer, the finding is `all_fail` and gives the closest gap. Nothing else is proposed.
- **Unavailable instead of guessed.** If an option's invoice is missing, or its terms do not fit the data, it is marked unavailable with the reason.

## Explicit splits (no double counting)

A and B pay one invoice in two parts through a `split_event` adjustment:

- The parts keep the invoice's document number and carry `split: { parentId, index, count }`.
- `applyScenario` rejects a split whose parts do not add up to the original amount.
- The shared double-count guard (`document-links.ts`) allows one document on several events only when they are the complete set of parts of one split.

## Options (demo terms)

| | Change vs delayed case | Explicit cost | Needs | Lowest cash | Ending cash |
| --- | --- | --- | --- | ---: | ---: |
| A. Partial collection | CAT-001: 4,000 RON on 9 Nov + 6,000 RON on 18 Nov (total 10,000 conserved) | 0 RON (no fee or discount in demo terms) | Customer acceptance | 1,000 RON (10 Nov) | 7,000 RON |
| B. Supplier deferral | SUP-001: 4,000 RON on 10 Nov + 4,000 RON on 20 Nov (total 8,000 kept) | Supplier fee 0 RON, **assumed for this labelled demo only** | Supplier acceptance | 1,000 RON (10 Nov) | 7,000 RON |
| C. Fictional financing | +3,500 RON and −100 RON fee on 9 Nov, −3,500 RON repayment on 20 Nov | 100 RON fee; no other charges | Bank approval. **Not a real bank offer or approval.** | 400 RON (10 Nov) | 6,900 RON |

For reference, the delayed case with no action has a lowest close of −3,000 RON on 10 Nov and ends at 7,000 RON.

## Minimum cash buffer

- Default 0 RON; set it on the Scenarios page. Stored as `DemoState.cashBuffer`; changing it bumps the data revision.
- An option fails when its lowest daily close is below the buffer. The card shows "Fails buffer by X".
- At 1,000 RON, A and B pass and C fails by 600 RON. At 1,500 RON, all fail (the closest is 500 RON short).

## Horizon

Events from an option that fall after the horizon end are excluded from the forecast and disclosed on the card:

- "Obligation outside the horizon" for repayments and deferred payments.
- "Receipt outside the horizon" for receipts.

With the Bucharest Cafe horizon (to 30 Nov), every repayment is inside the horizon.
