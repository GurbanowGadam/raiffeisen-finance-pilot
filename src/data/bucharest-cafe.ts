/**
 * Bucharest Cafe fixture adapter.
 *
 * The JSON file is the single source of truth for the baseline. The CSV file is
 * generated from it (`bun run fixtures:csv`) and a test keeps the two identical.
 */
import { DEMO_TODAY, parseDemoDataset, type DemoDataset } from "@/domain";

import { deepFreeze, type DataAdapter } from "./adapter";
import fixtureJson from "./fixtures/bucharest-cafe.v1.json";
import fixtureJsonUrl from "./fixtures/bucharest-cafe.v1.json?url";
import fixtureCsvUrl from "./fixtures/bucharest-cafe.v1.cash-events.csv?url";
import sampleRonCsvUrl from "./fixtures/sample-import.amount-ron.csv?url";
import sampleSimpleCsvUrl from "./fixtures/sample-import.simple.csv?url";

export const BUCHAREST_CAFE_DOWNLOADS = {
  json: { url: fixtureJsonUrl, filename: "bucharest-cafe.v1.json" },
  csv: { url: fixtureCsvUrl, filename: "bucharest-cafe.v1.cash-events.csv" },
} as const;

/**
 * Downloadable import samples: the simple Bucharest Cafe sheet (plain RON, 10 columns; a test keeps it
 * equivalent to the JSON fixture), the full fixture (amount_bani) and a short decimal example.
 */
export const IMPORT_SAMPLES = {
  simple: { url: sampleSimpleCsvUrl, filename: "bucharest-cafe-simple.csv" },
  bani: { url: fixtureCsvUrl, filename: "sample-import.bucharest-cafe.amount-bani.csv" },
  ron: { url: sampleRonCsvUrl, filename: "sample-import.amount-ron.csv" },
} as const;

export const bucharestCafeAdapter: DataAdapter = {
  id: "bucharest-cafe",
  loadBaseline(): DemoDataset {
    // structuredClone gives every call an independent copy before validation and freezing.
    return deepFreeze(parseDemoDataset(structuredClone(fixtureJson), DEMO_TODAY));
  },
};
