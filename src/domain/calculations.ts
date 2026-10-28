/**
 * Pure financial calculation module.
 *
 * Deterministic integer-bani arithmetic only. No UI, network, storage or AI imports.
 * Forecasts sum CashEvents only; receivables and other invoice documents are
 * never summed directly, so an invoice cannot be counted twice.
 * The daily cash-flow engine is implemented in a later step.
 */
import { bani } from "./money";
import type { CashEvent } from "./models";
import type { Bani } from "./types";

type Movement = Pick<CashEvent, "direction" | "amount">;

/** Signed bani effect of one item: inflows positive, outflows negative. */
export function signedAmount(item: Movement): Bani {
  return bani(item.direction === "inflow" ? item.amount : -item.amount);
}

/** Net signed effect of a list of cash events. */
export function netAmount(items: readonly Movement[]): Bani {
  let total = 0;
  for (const item of items) total += signedAmount(item);
  return bani(total);
}
