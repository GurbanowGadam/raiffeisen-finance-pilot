/**
 * Integer bani helpers. Pure and deterministic.
 * 100 bani = 1 RON. No floating-point money anywhere.
 */
import type { Bani } from "./types";

export const BANI_PER_RON = 100;

/** Validates and brands an integer as bani. Throws on non-integers or unsafe values. */
export function bani(value: number): Bani {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Bani must be a safe integer, received ${value}`);
  }
  return value as Bani;
}

/** Converts whole RON to bani. Only accepts integer RON to avoid float input. */
export function ronToBani(ron: number): Bani {
  if (!Number.isSafeInteger(ron)) {
    throw new RangeError(`ronToBani expects integer RON, received ${ron}`);
  }
  return bani(ron * BANI_PER_RON);
}

const DECIMAL_RON_PATTERN = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Converts a decimal RON string to bani by string parsing, never float maths.
 * Accepts "800", "800.5", "800.50", "-12.34". Rejects more than two decimals
 * (no silent rounding), thousands separators, exponents and whitespace.
 */
export function parseRonToBani(text: string): Bani {
  const match = DECIMAL_RON_PATTERN.exec(text);
  if (!match) {
    throw new RangeError(`Invalid RON amount "${text}": use digits with up to 2 decimals`);
  }
  const sign = match[1] === "-" ? -1 : 1;
  const whole = Number(match[2]);
  const fraction = Number((match[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(whole * BANI_PER_RON)) {
    throw new RangeError(`RON amount "${text}" is too large`);
  }
  return bani(sign * (whole * BANI_PER_RON + fraction));
}

/** Formats bani as a plain decimal RON string for inputs, e.g. 1200000 -> "12000.00". */
export function formatBaniDecimal(amount: Bani): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.trunc(abs / BANI_PER_RON);
  const fraction = abs - whole * BANI_PER_RON;
  return `${negative ? "-" : ""}${whole}.${fraction.toString().padStart(2, "0")}`;
}

/** Sums bani amounts exactly. */
export function sumBani(amounts: readonly Bani[]): Bani {
  let total = 0;
  for (const amount of amounts) total += amount;
  return bani(total);
}

/**
 * Formats bani as a RON string, e.g. 123456 -> "1,234.56 RON".
 * Uses integer division only; never divides into a float.
 */
export function formatBani(amount: Bani): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.trunc(abs / BANI_PER_RON);
  const fraction = abs - whole * BANI_PER_RON;
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fractionText = fraction.toString().padStart(2, "0");
  return `${negative ? "-" : ""}${wholeText}.${fractionText} RON`;
}
