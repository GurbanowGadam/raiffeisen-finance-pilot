# Simplify the app into a guided 1-2-3 flow

Goal: someone opening FinansalPilot for the first time can follow one clear path without hunting for buttons. All numbers, rules and calculations stay exactly the same. This is a screen layout and wording change only.

## The flow

```text
 1 See the problem      2 Pick a fix          3 Prepare the message
 (Overview)        ->   (Scenarios)      ->   (Actions)

 Side tools: Transactions (your data)   Assistant (ask questions)
```

## Changes

**Menu (left side and phone tabs)**
- Show the three main pages as numbered steps: "1 Overview", "2 Scenarios", "3 Actions".
- Put Transactions and Assistant below them, under a small "Tools" label.
- Page names stay the same, so the earlier demo script still works.

**Progress bar on every main page**
- A thin bar at the top shows: 1 See the problem → 2 Pick a fix → 3 Prepare the message.
- Each step gets a checkmark when it's done (a delay is applied, a draft exists, a proposal is accepted).
- Each page ends with one clear "Next: ..." button.

**Overview (simpler)**
- At the top: the status message and one big next-step card. Before a delay it says "Try it: what if the catering payment arrives late?", with the date picker and **Apply delay** button inside the card. After the delay, the card shows **Next: compare fixes**.
- Then the four key numbers and the chart.
- The daily figures table, the upcoming events list and the dataset details move into a collapsed "More details" section.
- The accepted-proposal notice becomes one short line.

**Scenarios (simpler)**
- One short sentence explains the situation: "Without action, cash drops to −3,000 RON on 10 Nov."
- The safety-buffer setting becomes a small, compact field.
- Next comes the result line, then the three option cards. Each card shows only: lowest cash, ending cash, cost, what approval it needs and a **Prepare draft** button. The conditions and assumptions move behind "Show details" in the card.
- The side-by-side table and the technical revision note move into a collapsed "Compare side by side" section.

**Transactions (simpler)**
- The import becomes three numbered boxes:
  1. **Download the sample:** the new simple CSV you just got is the main sample.
  2. **Fill in settings and choose your file:** the three settings already show the demo values.
  3. **Preview, then replace.**
- The summary of the current data becomes one line. The full event list moves into a collapsed section.
- A short "What each column means" box with plain descriptions.

## Not changing
- No numbers, calculations, rules, approvals, AI behavior or data format change.
- Assistant and Actions only get the menu and progress bar. Their content stays the same.

## Technical details
- New `src/components/flow/` with `flow-stepper.tsx` (progress derived from `DemoState`: delay scenario present, drafts present, accepted changes present) and `next-step.tsx`. The app shell groups nav into primary steps and tools.
- Overview: wrap `DailyTable`, `UpcomingEvents` and `BaselineDetails` in one shadcn `Collapsible`. `PaymentDelayControl` is embedded in a new next-step card. `KpiCards` and the chart are unchanged.
- Scenarios: `RecoveryOptionCard` gets a collapsible details area. `ComparisonTable` and the revision line move into a `Collapsible`. The `BufferControl` layout gets more compact.
- Transactions: `CsvImportPanel` is restructured into three numbered sections with the same validation and state logic (preview-then-replace is unchanged). Add the simple sample as `src/data/fixtures/sample-import.simple.csv`, generated from the fixture JSON by the existing `fixtures:csv` script, with an equality test like the existing fixture CSV.
- Update the affected UI tests (`csv-import-panel.test.tsx`, dashboard tests) only where text/structure changed. Domain tests stay untouched.
- Verify with Vitest, typecheck and Playwright at 957 px (the user's window), 1280 px and 390 px.
- Record this in PROGRESS.md as an owner-requested UI simplification outside the numbered steps.
