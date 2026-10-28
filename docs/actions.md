# Actions: drafts, simulated responses and accepted changes

Nothing on the Actions page sends, pays or submits anything. Responses are simulated.

## Drafts

`buildActionDraft` (`src/domain/action-drafts.ts`) builds one draft per recovery option from
the current comparison (`recoveryComparisonOf`, the same function the Scenarios page and the
assistant use):

| Option | Draft | Content |
| --- | --- | --- |
| A. Partial collection | Customer email | Invoice CAT-001, 4,000 RON by 9 Nov 2026, the remaining 6,000 RON expected on the delayed date (18 Nov in the fixture), total unchanged |
| B. Supplier deferral | Supplier email | Invoice SUP-001 in two parts (4,000 RON on 10 Nov, 4,000 RON on 20 Nov), total unchanged, asks whether a fee applies |
| C. Fictional financing | Bank-meeting brief (Markdown) | Cash gap (lowest close, first negative day, recovery date, shortfall, ending balance, buffer), the request table, the result with financing, key dates and source events, alternatives A/B with status, and fictional-product assumptions |

Amounts and dates come from the proposal's own adjustments (`basis.proposal`), which are
exactly what acceptance applies. Subject and body can be edited while the draft is a draft.
Edits never change `basis.proposal`. Emails can be copied; the brief can be copied or
downloaded as Markdown (`.md`) or plain text (`.txt`, via `markdownToPlainText`).

Each draft records `basis.datasetVersion`, `basis.revision`, `basis.proposal` and
`basis.fingerprint` (a hash of the generated subject and body).

## States and audit history

`draft` → `awaiting_response` (optional: the user sent it themselves outside Raiffeisen Finance Pilot)
→ `accepted` or `rejected`. Every change appends a history entry: event, status, wall-clock
timestamp `at`, demo `businessDate`, and the session revision.

## Freshness (stale drafts)

`draftFreshness` compares a draft with what would be generated from the current data:

- `dataset_changed`: the draft belongs to another dataset version. Blocked.
- `outdated`: the option is no longer available, its proposal changed (e.g. the delay moved
  the remainder date), or a figure the text quotes changed (fingerprint, e.g. the brief's gap
  after another proposal was accepted). Blocked: "Regenerate draft" is required before
  marking as sent or simulating acceptance.
- `current` + `rechecked`: the revision moved on but nothing in the draft changed (e.g. a
  buffer change for an email). Allowed, with a note.

Regenerating keeps the audit history and appends a `regenerated` entry.

## Simulate acceptance

`simulate_acceptance` (reducer) is allowed only for a current draft in `draft` or
`awaiting_response`. It:

1. appends an `AcceptedChange` (`acc-<option>`): the proposal's adjustments, timestamps, the
   session revision at acceptance, the draft's revision and the dataset version;
2. sets the draft to `accepted`;
3. bumps the revision once.

It is idempotent: a second acceptance of the same draft or option returns the state
unchanged, and drafts for an accepted option cannot be generated again.

The active case (`calculateActiveForecast`) is baseline + hypothetical delay + accepted
changes. For the same event, an accepted adjustment overrides the delay (an agreement takes
precedence over a what-if). Accepted events are labelled `accepted`. The opening (actual)
balance never changes, every event stays `forecast`, and receivables stay `open`. Accepted
options are shown as accepted and not re-evaluated; the remaining options are compared on
the active case.

## Simulate rejection

`simulate_rejection` sets the draft to `rejected` and adds the option to the rejected
options. The forecast is unchanged. The option is excluded from comparisons, so the
assistant (linked from the rejected card with a pre-filled question) reconsiders only the
remaining options.

## Lifetime

Replacing the dataset (CSV import) or Reset demo clears drafts and accepted changes.
