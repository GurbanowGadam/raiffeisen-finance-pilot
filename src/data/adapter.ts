/**
 * Data adapter contract.
 *
 * Adapters load datasets for the domain module. Only synthetic sources are
 * permitted; real bank connections are out of scope by contract.
 */
import type { DemoDataset } from "@/domain";

export const SYNTHETIC_DATA_LABEL = "Synthetic demo data";

export interface DataAdapter {
  readonly id: string;
  /** Returns a freshly validated, deeply frozen copy of the baseline dataset. */
  loadBaseline(): DemoDataset;
}

/** Recursively freezes a value so baseline data cannot be mutated by accident. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
