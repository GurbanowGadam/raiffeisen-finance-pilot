/**
 * Date-only business date helpers and the fixed demo clock.
 * Business logic must read "today" from DEMO_TODAY, never from the system clock.
 */
import type { BusinessDate } from "./types";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Returns true when the string is a real calendar date in YYYY-MM-DD format. */
export function isBusinessDate(value: string): value is BusinessDate {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** Validates and brands a YYYY-MM-DD string. Throws on invalid input. */
export function businessDate(value: string): BusinessDate {
  if (!isBusinessDate(value)) {
    throw new RangeError(`Invalid business date: ${value}`);
  }
  return value;
}

/** Adds whole calendar days to a business date. Uses UTC so no DST or timezone shifts apply. */
export function addDays(date: BusinessDate, days: number): BusinessDate {
  if (!Number.isSafeInteger(days))
    throw new RangeError(`Days must be an integer, received ${days}`);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return businessDate(next.toISOString().slice(0, 10));
}

/** Every business date from start to end inclusive. Throws if start is after end or the range exceeds maxDays. */
export function enumerateDates(
  start: BusinessDate,
  end: BusinessDate,
  maxDays = 3660,
): BusinessDate[] {
  if (start > end) throw new RangeError(`Range start ${start} is after end ${end}`);
  const dates: BusinessDate[] = [];
  for (let current = start; current <= end; current = addDays(current, 1)) {
    dates.push(current);
    if (dates.length > maxDays) throw new RangeError(`Range exceeds ${maxDays} days`);
  }
  return dates;
}

/**
 * Fixed demo clock. All forecasts treat this date as "today".
 * Equals the forecast horizon start, so every fixture event is still in the future.
 */
export const DEMO_TODAY: BusinessDate = businessDate("2026-11-01");
