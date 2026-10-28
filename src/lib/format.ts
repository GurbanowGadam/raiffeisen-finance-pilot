/**
 * Presentation-only formatters. They never perform financial arithmetic;
 * amounts arrive as integer bani from the domain module.
 */
import { BANI_PER_RON, type Bani } from "@/domain";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-04" -> "4 Nov". Parses the string; no Date or timezone involved. */
export function formatShortDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? "?"}`;
}

/** "2026-11-04" -> "Wed 4 Nov 2026". Weekday computed in UTC from the date-only string. */
export function formatLongDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  ];
  return `${weekday} ${d} ${MONTHS[m - 1]} ${y}`;
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** Axis label in whole RON, e.g. 1_200_000 bani -> "12K". Truncates bani for display only. */
export function formatRonCompact(amount: Bani | number): string {
  return compact.format(Math.trunc(amount / BANI_PER_RON));
}
