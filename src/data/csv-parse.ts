/**
 * Minimal RFC 4180 CSV reader. Pure; no network or storage.
 *
 * Supports quoted fields with commas, escaped quotes ("") and line breaks,
 * LF or CRLF line endings, a UTF-8 byte-order mark and a trailing newline.
 * Every returned row carries the 1-based line number where it starts.
 */

export interface CsvRow {
  readonly line: number;
  readonly cells: readonly string[];
}

export type CsvParseResult =
  | { readonly ok: true; readonly rows: readonly CsvRow[] }
  | { readonly ok: false; readonly line: number; readonly message: string };

export function parseCsv(input: string): CsvParseResult {
  const text = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let quotedCell = false;
  let line = 1;
  let rowLine = 1;

  const endCell = () => {
    cells.push(cell);
    cell = "";
    quotedCell = false;
  };
  const endRow = () => {
    endCell();
    // Skip completely blank lines.
    if (!(cells.length === 1 && cells[0] === "")) rows.push({ line: rowLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (cell !== "" || quotedCell) {
        return { ok: false, line, message: "Unexpected quote inside an unquoted field" };
      }
      inQuotes = true;
      quotedCell = true;
    } else if (ch === ",") {
      endCell();
    } else if (ch === "\r" && text[i + 1] === "\n") {
      // CRLF: the \n branch ends the row.
    } else if (ch === "\n" || ch === "\r") {
      endRow();
      line++;
      rowLine = line;
    } else {
      if (quotedCell) {
        return { ok: false, line, message: "Unexpected text after a closing quote" };
      }
      cell += ch;
    }
  }
  if (inQuotes) return { ok: false, line: rowLine, message: "Unterminated quoted field" };
  if (cell !== "" || cells.length > 0 || quotedCell) endRow();
  return { ok: true, rows };
}
