import { describe, expect, it } from "vitest";

import { DEMO_TODAY, calculateDatasetCashFlow, ronToBani } from "@/domain";

import { bucharestCafeAdapter } from "./bucharest-cafe";
import { cashEventsToCsv, neutralizeFormula, restoreFormulaEscape } from "./csv";
import { IMPORT_LIMITS, previewCashEventCsv, type ImportSettings } from "./csv-import";
import { parseCsv } from "./csv-parse";
import fixtureCsv from "./fixtures/bucharest-cafe.v1.cash-events.csv?raw";
import sampleRonCsv from "./fixtures/sample-import.amount-ron.csv?raw";

const fixture = bucharestCafeAdapter.loadBaseline();
const SETTINGS: ImportSettings = {
  openingBalanceRon: "12000.00",
  horizonStart: "2026-11-01",
  horizonEnd: "2026-11-30",
};
const CONTEXT = { fileName: "test.csv", profile: fixture.profile, today: DEMO_TODAY };
const HEADER = "id,date,direction,amount_bani,currency,description";

const preview = (text: string, settings: ImportSettings = SETTINGS) =>
  previewCashEventCsv(text, settings, CONTEXT);

const rowErrors = (text: string) =>
  preview(text)
    .rows.filter((r) => r.errors.length)
    .map((r) => ({ line: r.line, errors: r.errors }));

describe("valid import", () => {
  it("imports the documented sample CSV and reproduces the Step 2 baseline exactly", () => {
    const result = preview(fixtureCsv);
    expect(result.errorCount).toBe(0);
    expect(result.dataset).not.toBeNull();
    expect(result.dataset!.cashEvents).toEqual(fixture.cashEvents);
    expect(result.dataset!.receivables).toEqual(fixture.receivables);
    expect(result.dataset!.profile.openingBalance.amount).toBe(ronToBani(12_000));
    expect(result.dataset!.datasetVersion).toMatch(/^csv-import@[0-9a-f]{8}$/);
  });

  it("produces the same forecast as the fixture (7,000 RON ending, minimum on 10 Nov)", () => {
    const forecast = calculateDatasetCashFlow(preview(fixtureCsv).dataset!, DEMO_TODAY);
    expect(forecast.endingBalance).toBe(ronToBani(7_000));
    expect(forecast.minimumClosingDate).toBe("2026-11-10");
  });

  it("uses the opening balance and dates from the import settings", () => {
    const result = preview(fixtureCsv, { ...SETTINGS, openingBalanceRon: "-250.5" });
    expect(result.dataset!.profile.openingBalance.amount).toBe(-25_050);
  });

  it("parses decimal amount_ron values exactly and keeps quoted commas", () => {
    const result = preview(sampleRonCsv);
    expect(result.errorCount).toBe(0);
    const amounts = Object.fromEntries(result.dataset!.cashEvents.map((e) => [e.id, e.amount]));
    expect(amounts).toEqual({
      "evt-sales-2026-11-01": 80_000,
      "evt-cat-001": 1_000_000,
      "evt-rent-2026-11": 600_050,
    });
    expect(result.dataset!.cashEvents.find((e) => e.id === "evt-rent-2026-11")!.description).toBe(
      "Monthly rent, incl. service charge",
    );
  });

  it("is deterministic: the same file and settings give the same dataset version", () => {
    expect(preview(fixtureCsv).dataset!.datasetVersion).toBe(
      preview(fixtureCsv).dataset!.datasetVersion,
    );
  });
});

describe("malformed date", () => {
  it("reports the row and line, and produces no dataset", () => {
    const result = preview(
      `${HEADER}\na,2026-11-02,inflow,100,RON,Ok\nb,2026-11-31,inflow,100,RON,Bad\n`,
    );
    expect(result.dataset).toBeNull();
    expect(result.rows[0]!.errors).toEqual([]);
    expect(result.rows[1]!.line).toBe(3);
    expect(result.rows[1]!.errors).toEqual([
      'date "2026-11-31" is not a valid YYYY-MM-DD calendar date',
    ]);
  });

  it("rejects non-ISO formats and dates outside the forecast range", () => {
    expect(rowErrors(`${HEADER}\na,02/11/2026,inflow,1,RON,x\n`)[0]!.errors[0]).toMatch(
      /not a valid YYYY-MM-DD/,
    );
    expect(rowErrors(`${HEADER}\na,2026-10-31,inflow,1,RON,x\n`)[0]!.errors[0]).toMatch(
      /before the forecast start.*opening balance/,
    );
    expect(rowErrors(`${HEADER}\na,2026-12-01,inflow,1,RON,x\n`)[0]!.errors[0]).toMatch(
      /after the forecast end/,
    );
  });
});

describe("missing header", () => {
  it("rejects a file without a required column and parses no rows", () => {
    const result = preview("id,direction,amount_bani,currency,description\na,inflow,1,RON,x\n");
    expect(result.headerErrors).toEqual(['Missing required column "date"']);
    expect(result.rows).toEqual([]);
    expect(result.dataset).toBeNull();
  });

  it("requires exactly one amount column and rejects unknown or repeated columns", () => {
    expect(preview("id,date,direction,currency,description\n").headerErrors).toContain(
      'Missing amount column: provide "amount_bani" or "amount_ron"',
    );
    expect(preview(`${HEADER},amount_ron\n`).headerErrors).toContain(
      'Provide only one of "amount_bani" or "amount_ron", not both',
    );
    expect(preview(`${HEADER},amount\n`).headerErrors).toContain('Unknown column "amount"');
    expect(preview(`${HEADER},id\n`).headerErrors).toContain('Column "id" appears more than once');
  });

  it("rejects an empty file", () => {
    expect(preview("").fileErrors).toEqual(["File is empty; a header row is required"]);
  });
});

describe("duplicate ID", () => {
  it("flags the second occurrence with the line of the first", () => {
    const result = preview(
      `${HEADER}\ndup,2026-11-02,inflow,100,RON,First\ndup,2026-11-03,inflow,100,RON,Second\n`,
    );
    expect(result.dataset).toBeNull();
    expect(result.rows[0]!.errors).toEqual([]);
    expect(result.rows[1]!.errors).toEqual(['Duplicate id "dup" (first used on line 2)']);
  });

  it("flags a document number used twice (invoice would be counted twice)", () => {
    const text =
      "id,date,direction,amount_bani,currency,description,document_number\n" +
      "a,2026-11-02,inflow,100,RON,x,INV-1\nb,2026-11-03,inflow,100,RON,y,inv-1\n";
    expect(rowErrors(text)).toEqual([
      {
        line: 3,
        errors: ['Document "inv-1" is already linked to line 2; it would be counted twice'],
      },
    ]);
  });
});

describe("field validation", () => {
  it.each([
    ["a,2026-11-02,inflow,0,RON,x", /greater than zero/],
    ["a,2026-11-02,inflow,-5,RON,x", /whole number of bani/],
    ["a,2026-11-02,inflow,10.5,RON,x", /whole number of bani/],
    ["a,2026-11-02,inflow,100,EUR,x", /Unsupported currency "EUR".*never converted/],
    ["a,2026-11-02,in,100,RON,x", /direction "in" must be/],
    ["A B,2026-11-02,inflow,100,RON,x", /lowercase slug/],
    ["a,2026-11-02,inflow,100,RON,", /description is required/],
  ])("rejects %s", (row, message) => {
    expect(rowErrors(`${HEADER}\n${row}\n`)[0]!.errors.join(" ")).toMatch(message);
  });

  it("rejects badly formatted amount_ron values", () => {
    const header = "id,date,direction,amount_ron,currency,description";
    for (const value of ["1.234", "1,5", "-3", "1e3", "12 000"]) {
      expect(rowErrors(`${header}\na,2026-11-02,inflow,"${value}",RON,x\n`)).toHaveLength(1);
    }
  });

  it("rejects future actual payments and non-baseline layers", () => {
    const header = "id,date,direction,amount_bani,currency,description,status,layer";
    expect(rowErrors(`${header}\na,2026-11-05,inflow,1,RON,x,actual,\n`)[0]!.errors[0]).toMatch(
      /not allowed for a future date/,
    );
    expect(rowErrors(`${header}\na,2026-11-05,inflow,1,RON,x,,scenario\n`)[0]!.errors[0]).toMatch(
      /always become the baseline/,
    );
  });

  it("requires a document number and counterparty for receivable rows", () => {
    const header = "id,date,direction,amount_bani,currency,description,source_kind";
    const errors = rowErrors(`${header}\na,2026-11-05,outflow,1,RON,x,receivable\n`)[0]!.errors;
    expect(errors).toContain("A receivable row must be an inflow");
    expect(errors).toContain("A receivable row needs a document_number (invoice number)");
    expect(errors).toContain("A receivable row needs a counterparty");
  });

  it("reports wrong cell counts", () => {
    expect(rowErrors(`${HEADER}\na,2026-11-02,inflow,100,RON\n`)[0]!.errors[0]).toMatch(
      /5 cells; the header has 6/,
    );
  });
});

describe("settings", () => {
  it("validates opening balance and dates", () => {
    const result = preview(fixtureCsv, {
      openingBalanceRon: "12.000,00",
      horizonStart: "2026-11-30",
      horizonEnd: "2026-11-01",
    });
    expect(result.dataset).toBeNull();
    expect(result.settingsErrors.join(" ")).toMatch(/not a valid RON amount/);
    expect(result.settingsErrors).toContain("Forecast start must not be after forecast end");
  });

  it("limits the horizon to 366 days", () => {
    // 2026-11-01..2027-11-01 inclusive is exactly 366 days: allowed. One more day is not.
    expect(
      preview(`${HEADER}\n`, { ...SETTINGS, horizonEnd: "2027-11-01" }).settingsErrors,
    ).toEqual([]);
    expect(
      preview(`${HEADER}\n`, { ...SETTINGS, horizonEnd: "2027-11-02" }).settingsErrors,
    ).toContain("Forecast horizon is longer than 366 days");
  });
});

describe("limits", () => {
  it("rejects files over 256 KB", () => {
    const big = `${HEADER}\n` + "x".repeat(IMPORT_LIMITS.maxBytes);
    expect(preview(big).fileErrors[0]).toMatch(/larger than 256 KB/);
  });

  it("rejects more than 2,000 rows", () => {
    const rows = Array.from({ length: 2_001 }, (_, i) => `e${i},2026-11-02,inflow,1,RON,x`);
    expect(preview(`${HEADER}\n${rows.join("\n")}\n`).fileErrors[0]).toMatch(
      /2001 rows; the limit is 2000/,
    );
  });

  it("accepts exactly 2,000 rows", () => {
    const rows = Array.from({ length: 2_000 }, (_, i) => `e${i},2026-11-02,inflow,1,RON,x`);
    expect(preview(`${HEADER}\n${rows.join("\n")}\n`).errorCount).toBe(0);
  });
});

describe("escaping", () => {
  it("neutralises spreadsheet formulas on export and restores them on import", () => {
    expect(neutralizeFormula("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(neutralizeFormula("Monthly rent")).toBe("Monthly rent");
    expect(restoreFormulaEscape("'=HYPERLINK(1)")).toBe("=HYPERLINK(1)");
    expect(restoreFormulaEscape("'quoted")).toBe("'quoted");

    const text = `${HEADER},counterparty\na,2026-11-02,inflow,100,RON,"=SUM(A1,A2)","@cmd"\n`;
    const dataset = preview(text).dataset!;
    expect(dataset.cashEvents[0]!.description).toBe("=SUM(A1,A2)");
    const exported = cashEventsToCsv(dataset.cashEvents);
    expect(exported).toContain(`"'=SUM(A1,A2)",'@cmd`);
    // Round trip: exporting and re-importing keeps the original text.
    expect(preview(exported).dataset!.cashEvents[0]!.description).toBe("=SUM(A1,A2)");
  });

  it("keeps HTML in text as plain characters (rendered escaped by React)", () => {
    const dataset = preview(
      `${HEADER}\na,2026-11-02,inflow,100,RON,<img src=x onerror=alert(1)>\n`,
    ).dataset!;
    expect(dataset.cashEvents[0]!.description).toBe("<img src=x onerror=alert(1)>");
  });

  it("rejects control characters in text", () => {
    expect(
      rowErrors(`${HEADER}\na,2026-11-02,inflow,100,RON,"bad\u0007bell"\n`)[0]!.errors,
    ).toEqual(["description contains control characters"]);
  });
});

describe("CSV reader", () => {
  it("handles BOM, CRLF, quotes, escaped quotes and embedded newlines", () => {
    const result = parseCsv('\uFEFFa,b\r\n"x, y","he said ""hi"""\r\n"multi\nline",z\r\n');
    expect(result).toEqual({
      ok: true,
      rows: [
        { line: 1, cells: ["a", "b"] },
        { line: 2, cells: ["x, y", 'he said "hi"'] },
        { line: 3, cells: ["multi\nline", "z"] },
      ],
    });
  });

  it("reports unterminated quotes and stray quotes with a line number", () => {
    expect(parseCsv('a,b\n"open,c\n')).toEqual({
      ok: false,
      line: 2,
      message: "Unterminated quoted field",
    });
    expect(parseCsv('a,b\nx"y,c\n')).toMatchObject({ ok: false, line: 2 });
  });

  it("turns syntax errors into file errors in the preview", () => {
    expect(preview(`${HEADER}\n"broken,2026-11-02\n`).fileErrors[0]).toMatch(
      /CSV syntax error on line 2/,
    );
  });
});
