/**
 * Regenerates the CSV cash-event fixture from the JSON fixture.
 * Usage: bun run fixtures:csv
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DEMO_TODAY, parseDemoDataset } from "../src/domain";
import { cashEventsToCsv } from "../src/data/csv";
import fixture from "../src/data/fixtures/bucharest-cafe.v1.json";

const dataset = parseDemoDataset(fixture, DEMO_TODAY);
const target = fileURLToPath(
  new URL("../src/data/fixtures/bucharest-cafe.v1.cash-events.csv", import.meta.url),
);
writeFileSync(target, cashEventsToCsv(dataset.cashEvents));
console.log(`Wrote ${dataset.cashEvents.length} cash events to ${target}`);
