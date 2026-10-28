/**
 * Cross-record integrity rules for a DemoDataset. Pure and deterministic.
 *
 * These rules guarantee, among other things, that an invoice and its linked
 * cash event can never be counted twice:
 * - Forecasts sum CashEvents only; Receivables carry no countable amount.
 * - Each Receivable links to exactly one CashEvent with the same amount,
 *   currency and document number, and that event points back to it.
 * - A document number (e.g. CAT-001, SUP-001) appears on at most one CashEvent.
 */
import { documentLinkIssues } from "./document-links";
import { demoDatasetSchema, type DemoDataset } from "./models";
import type { BusinessDate } from "./types";

export class DatasetIntegrityError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Dataset failed integrity checks:\n- ${issues.join("\n- ")}`);
    this.name = "DatasetIntegrityError";
  }
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

/** Returns a list of human-readable integrity problems; empty when the dataset is consistent. */
export function datasetIntegrityIssues(dataset: DemoDataset, today: BusinessDate): string[] {
  const issues: string[] = [];
  const { profile, cashEvents, receivables } = dataset;

  for (const id of duplicates(cashEvents.map((e) => e.id))) {
    issues.push(`Duplicate cash event id "${id}"`);
  }
  for (const id of duplicates(receivables.map((r) => r.id))) {
    issues.push(`Duplicate receivable id "${id}"`);
  }
  for (const id of duplicates(dataset.assumptions.map((a) => a.id))) {
    issues.push(`Duplicate assumption id "${id}"`);
  }

  if (profile.openingBalance.currency !== profile.currency) {
    issues.push("Opening balance currency differs from the business currency");
  }
  if (profile.openingBalance.asOf !== profile.horizon.start) {
    issues.push("Opening balance date must equal the forecast horizon start");
  }

  for (const event of cashEvents) {
    if (event.currency !== profile.currency) {
      issues.push(`Cash event "${event.id}" uses ${event.currency}, expected ${profile.currency}`);
    }
    if (event.date < profile.horizon.start) {
      issues.push(
        `Cash event "${event.id}" is dated before the opening balance; historical rows are already included in it`,
      );
    }
    if (event.date > profile.horizon.end) {
      issues.push(`Cash event "${event.id}" is dated after the forecast horizon`);
    }
    if (event.status === "actual" && event.date > today) {
      issues.push(`Cash event "${event.id}" is marked actual but is dated in the future`);
    }
  }

  // An invoice document may carry cash in only one event (or the parts of one explicit split).
  issues.push(...documentLinkIssues(cashEvents));
  for (const doc of duplicates(receivables.map((r) => r.documentNumber))) {
    issues.push(`Receivable document "${doc}" appears more than once`);
  }

  const eventsById = new Map(cashEvents.map((e) => [e.id, e]));
  for (const receivable of receivables) {
    const event = eventsById.get(receivable.cashEventId);
    if (!event) {
      issues.push(
        `Receivable "${receivable.id}" links to missing cash event "${receivable.cashEventId}"`,
      );
      continue;
    }
    if (event.source.kind !== "receivable" || event.source.id !== receivable.id) {
      issues.push(`Cash event "${event.id}" does not point back to receivable "${receivable.id}"`);
    }
    if (event.source.documentNumber !== receivable.documentNumber) {
      issues.push(
        `Cash event "${event.id}" document number differs from "${receivable.documentNumber}"`,
      );
    }
    if (event.direction !== "inflow") {
      issues.push(`Cash event "${event.id}" for receivable "${receivable.id}" must be an inflow`);
    }
    if (event.amount !== receivable.amount || event.currency !== receivable.currency) {
      issues.push(`Cash event "${event.id}" amount differs from receivable "${receivable.id}"`);
    }
    if (receivable.currency !== profile.currency) {
      issues.push(
        `Receivable "${receivable.id}" uses ${receivable.currency}, expected ${profile.currency}`,
      );
    }
  }

  const linkedEventIds = new Set(receivables.map((r) => r.cashEventId));
  for (const event of cashEvents) {
    if (event.source.kind === "receivable" && !linkedEventIds.has(event.id)) {
      issues.push(
        `Cash event "${event.id}" claims a receivable source but no receivable links to it`,
      );
    }
  }

  return issues;
}

/** Validates shape (Zod) and integrity. Throws on any problem; returns a typed dataset. */
export function parseDemoDataset(input: unknown, today: BusinessDate): DemoDataset {
  const dataset = demoDatasetSchema.parse(input);
  const issues = datasetIntegrityIssues(dataset, today);
  if (issues.length > 0) throw new DatasetIntegrityError(issues);
  return dataset;
}
