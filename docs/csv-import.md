# CSV cash-event import

Location: **Transactions → Import cash events (CSV)**. Code: `src/data/csv-import.ts` (pure parser and validator), `src/data/csv-parse.ts` (RFC 4180 reader) and `src/components/import/`.

Use synthetic data only. Never import real bank or customer data.

## Flow

1. **Enter import settings:**
   - **Opening balance (RON):** the balance at the start of the first forecast day. It already includes all history.
   - **Forecast start** and **Forecast end (inclusive):** `YYYY-MM-DD` dates.
2. **Choose a file → Preview import.** Every row is parsed and validated, and errors are listed per row with their line number. Nothing changes yet.
3. **Replace active dataset** is only enabled when the whole preview is valid. Confirming:
   - replaces all current cash events and receivables (nothing is appended),
   - recalculates the dashboard,
   - discards every scenario, action draft and agent run, because they were computed on the old data.
4. **Cancel import**, an invalid preview, or a file that cannot be read all leave the current dataset untouched.
5. **Reset demo** always restores the Bucharest Cafe fixture.

## Samples

Download these from the import panel:

- `bucharest-cafe-simple.csv` (step 1 of the import panel, recommended): the Bucharest Cafe baseline with 10 plain columns and amounts in RON. Importing it with opening balance 12000.00 and dates 2026-11-01 to 2026-11-30 gives the same daily forecast as the built-in fixture (tested in `src/data/simple-sample.test.ts`).
- `sample-import.bucharest-cafe.amount-bani.csv`: the full Step 2 fixture, using `amount_bani`. Importing it with the same settings reproduces the baseline exactly.
- `sample-import.amount-ron.csv`: a short example with decimal `amount_ron` values and a quoted comma.

## Columns

| Column | Required | Rule |
| --- | --- | --- |
| `id` | yes | Lowercase slug (`a-z`, `0-9`, `-`); unique in the file |
| `date` | yes | Real calendar date `YYYY-MM-DD`, within the forecast range. Earlier dates are rejected because history belongs in the opening balance. |
| `direction` | yes | `inflow` or `outflow` |
| `amount_bani` **or** `amount_ron` | exactly one | See "Amounts" below |
| `currency` | yes | `RON` only. Other currencies are rejected, never converted. |
| `description` | yes | Up to 200 characters, no control characters |
| `category` | no | `sales`, `receivable`, `supplier`, `payroll`, `rent`, `utilities`, `tax`, `financing`, `other` (default `other`) |
| `status` | no | `forecast` (default) or `actual`; `actual` is not allowed for future dates |
| `layer` | no | Empty or `baseline`; imported rows always become the baseline |
| `counterparty` | no | Up to 200 characters |
| `source_kind` | no | `user` (default), `fixture`, `receivable`, `supplier_invoice` |
| `source_id` | no | Slug; defaults to `id` |
| `document_number` | no | Up to 50 characters: letters, digits and `. _ / -`. Unique in the file, ignoring case. |

Column names are case-insensitive. Unknown or repeated columns are rejected.

**Receivable rows** (`source_kind = receivable`) must be inflows and need a `document_number` and a `counterparty`. Each one creates one receivable linked to that row, so an invoice can never be counted twice. **Supplier invoice rows** need a `document_number`.

## Amounts (decimal format)

- `amount_bani`: a whole positive number of bani with digits only. `80000` = 800.00 RON.
- `amount_ron`: a positive decimal with a **dot** as the decimal separator and at most **2** decimals: `800`, `800.5`, `800.50`.
  - Not accepted: thousands separators (`12,000` or `12 000`), a comma decimal (`800,50`), currency symbols, exponents, minus signs, or more than 2 decimals. Nothing is rounded.
  - Conversion uses string parsing, never floating-point arithmetic.
- Direction carries the sign; amounts must be greater than zero.
- The opening balance setting uses the same decimal format and may be negative (for example `-250.50`).

## File format and limits

- UTF-8 text with an optional BOM, comma-separated, a header row, LF or CRLF line endings.
- Quoted fields may contain commas, line breaks and escaped quotes (`""`).
- Blank lines are ignored.

| Limit | Value |
| --- | --- |
| File size | 256 KB (checked before reading) |
| Data rows | 2,000 |
| Forecast horizon | 366 days |
| Text fields | 200 characters (document number: 50) |

## Escaping

- **In the UI:** imported text is always rendered as plain React text, never as HTML. A description like `<img src=x onerror=…>` is shown literally; this is covered by a test.
- **In exported CSV** (Transactions → Export active CSV):
  - Cells are RFC 4180 quoted.
  - Free-text cells that start with `=`, `+`, `-`, `@`, tab or carriage return get a leading `'`, so spreadsheet apps do not run them as formulas.
  - The importer removes exactly that prefix again, so export → import round-trips the original text.
