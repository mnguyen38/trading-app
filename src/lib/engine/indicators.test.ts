import { describe, it, expect } from "vitest";
import { hv30, rsi, sma, monthReturn, quarterReturn, high52w, lastClose } from "./indicators";
import type { Bar } from "../alpaca";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBars(closes: number[]): Bar[] {
  return closes.map((c, i) => ({
    t: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    o: c, h: c, l: c, c, v: 1_000_000,
  }));
}

// 31 flat bars → HV30 = 0 (no movement)
const flatBars = makeBars(Array(31).fill(100));

// 31 bars going up 1% each day → consistent positive log returns
const trendBars = makeBars(Array.from({ length: 31 }, (_, i) => 100 * 1.01 ** i));

// ── hv30 ─────────────────────────────────────────────────────────────────────

describe("hv30()", () => {
  it("returns NaN when fewer than 31 bars", () => {
    expect(hv30(makeBars(Array(30).fill(100)))).toBeNaN();
  });

  it("returns 0 for completely flat prices", () => {
    expect(hv30(flatBars)).toBe(0);
  });

  it("returns a positive number for trending prices", () => {
    const hv = hv30(trendBars);
    expect(hv).toBeGreaterThan(0);
    expect(hv).toBeLessThan(200); // sanity: 1%/day trend is ~16% annualised
  });

  it("uses only the last 31 bars when given more", () => {
    // Prepend 10 volatile bars, then 31 flat bars — HV30 should still be 0
    const noisyPrefix = makeBars([50, 200, 50, 200, 50, 200, 50, 200, 50, 200]);
    const result = hv30([...noisyPrefix, ...flatBars]);
    expect(result).toBe(0);
  });
});

// ── sma ──────────────────────────────────────────────────────────────────────

describe("sma()", () => {
  it("returns NaN when fewer values than period", () => {
    expect(sma([1, 2, 3], 5)).toBeNaN();
  });

  it("computes average of exactly period values", () => {
    expect(sma([10, 20, 30], 3)).toBe(20);
  });

  it("uses only the last period values", () => {
    // First 7 values are 0, last 3 are 10,20,30 — average of last 3 = 20
    expect(sma([0, 0, 0, 0, 0, 0, 0, 10, 20, 30], 3)).toBe(20);
  });
});

// ── rsi ──────────────────────────────────────────────────────────────────────

describe("rsi()", () => {
  it("returns NaN when fewer than period+1 closes", () => {
    expect(rsi(Array(14).fill(100), 14)).toBeNaN();
  });

  it("returns 100 when all moves are gains (no losses)", () => {
    const allUp = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(allUp, 14)).toBe(100);
  });

  it("returns ~50 for alternating up/down of equal size", () => {
    const zigzag = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 100 : 101));
    const val = rsi(zigzag, 14);
    // Should be close to 50 (equal avg gain and loss)
    expect(val).toBeGreaterThan(40);
    expect(val).toBeLessThan(60);
  });

  it("returns low RSI for consistent downtrend", () => {
    const downtrend = Array.from({ length: 20 }, (_, i) => 200 - i);
    expect(rsi(downtrend, 14)).toBeLessThan(30);
  });
});

// ── monthReturn ───────────────────────────────────────────────────────────────

describe("monthReturn()", () => {
  it("returns NaN when fewer than 22 bars", () => {
    expect(monthReturn(makeBars(Array(21).fill(100)))).toBeNaN();
  });

  it("returns 0 for flat prices", () => {
    expect(monthReturn(makeBars(Array(22).fill(100)))).toBe(0);
  });

  it("returns ~10% for 10% price increase over 22 bars", () => {
    const bars = makeBars([100, ...Array(21).fill(110)]);
    expect(monthReturn(bars)).toBeCloseTo(0.1, 5);
  });
});

// ── high52w ───────────────────────────────────────────────────────────────────

describe("high52w()", () => {
  it("returns the highest close in the last 252 bars", () => {
    const prices = Array.from({ length: 260 }, (_, i) => i + 1);
    // Bars 0-7 have closes 1-8, bars 8-259 have closes 9-260
    // Last 252 bars (indices 8-259) have max close = 260
    expect(high52w(makeBars(prices))).toBe(260);
  });

  it("ignores bars outside the 252-bar window", () => {
    // First 10 bars have close=9999, last 252 bars have closes 1-252
    const prefix = makeBars(Array(10).fill(9999));
    const window = makeBars(Array.from({ length: 252 }, (_, i) => i + 1));
    expect(high52w([...prefix, ...window])).toBe(252);
  });
});

// ── lastClose ─────────────────────────────────────────────────────────────────

describe("lastClose()", () => {
  it("returns NaN for empty array", () => {
    expect(lastClose([])).toBeNaN();
  });

  it("returns the last bar's close", () => {
    expect(lastClose(makeBars([10, 20, 30]))).toBe(30);
  });
});

// ── quarterReturn ─────────────────────────────────────────────────────────────

describe("quarterReturn()", () => {
  it("returns NaN when fewer than 91 bars", () => {
    expect(quarterReturn(makeBars(Array(90).fill(100)))).toBeNaN();
  });

  it("returns 0 for flat prices", () => {
    expect(quarterReturn(makeBars(Array(91).fill(100)))).toBe(0);
  });
});
