import { describe, expect, it } from "vitest";

import {
  DEMO_TODAY,
  bani,
  businessDate,
  formatBani,
  isBusinessDate,
  netAmount,
  ronToBani,
  sumBani,
} from "@/domain";

describe("money (integer bani)", () => {
  it("converts 1 RON to 100 bani", () => {
    expect(ronToBani(1)).toBe(100);
  });

  it("rejects fractional bani", () => {
    expect(() => bani(10.5)).toThrow(RangeError);
  });

  it("rejects fractional RON input", () => {
    expect(() => ronToBani(0.1)).toThrow(RangeError);
  });

  it("sums exactly without float drift", () => {
    expect(sumBani([bani(10), bani(20)])).toBe(30);
  });

  it("formats bani as RON with thousands separators", () => {
    expect(formatBani(bani(123456))).toBe("1,234.56 RON");
    expect(formatBani(bani(-5))).toBe("-0.05 RON");
  });
});

describe("business dates", () => {
  it("accepts a valid YYYY-MM-DD date", () => {
    expect(isBusinessDate("2026-02-28")).toBe(true);
  });

  it("rejects impossible or badly formatted dates", () => {
    expect(isBusinessDate("2026-02-30")).toBe(false);
    expect(isBusinessDate("2026-2-3")).toBe(false);
    expect(() => businessDate("2026-13-01")).toThrow(RangeError);
  });

  it("uses a fixed demo clock equal to the horizon start", () => {
    expect(DEMO_TODAY).toBe("2026-11-01");
  });
});

describe("calculations", () => {
  it("nets inflows minus outflows in bani", () => {
    expect(
      netAmount([
        { direction: "inflow", amount: bani(50000) },
        { direction: "outflow", amount: bani(12345) },
      ]),
    ).toBe(37655);
  });
});
