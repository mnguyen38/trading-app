import { describe, it, expect } from "vitest";
import {
  returnsFromEquity, sharpeRatio, sortinoRatio, maxDrawdownPct,
  impliedTradesPerYear, matchRoundTrips, type OrderFill, type RoundTrip,
} from "./performance";

// ── returnsFromEquity ─────────────────────────────────────────────────────────

describe("returnsFromEquity()", () => {
  it("returns one fewer value than the input", () => {
    expect(returnsFromEquity([100, 110, 121])).toHaveLength(2);
  });

  it("computes simple percentage change", () => {
    expect(returnsFromEquity([100, 110])[0]).toBeCloseTo(0.1, 5);
  });

  it("skips a step where the prior value is zero", () => {
    expect(returnsFromEquity([0, 100, 110])).toHaveLength(1);
  });
});

// ── sharpeRatio / sortinoRatio ────────────────────────────────────────────────

describe("sharpeRatio()", () => {
  it("returns null with fewer than 2 returns", () => {
    expect(sharpeRatio([0.01], 252)).toBeNull();
  });

  it("returns null when returns have zero variance", () => {
    expect(sharpeRatio([0.01, 0.01, 0.01], 252)).toBeNull();
  });

  it("is positive for a consistently positive return series", () => {
    const returns = [0.01, 0.02, 0.005, 0.015, 0.01];
    expect(sharpeRatio(returns, 252)!).toBeGreaterThan(0);
  });

  it("is negative for a consistently negative return series", () => {
    const returns = [-0.01, -0.02, -0.005, -0.015, -0.01];
    expect(sharpeRatio(returns, 252)!).toBeLessThan(0);
  });
});

describe("sortinoRatio()", () => {
  it("returns null when there is no downside in the sample", () => {
    expect(sortinoRatio([0.01, 0.02, 0.03], 252)).toBeNull();
  });

  it("is positive when upside outweighs a small downside", () => {
    const returns = [0.05, 0.04, -0.01, 0.03];
    expect(sortinoRatio(returns, 252)!).toBeGreaterThan(0);
  });
});

// ── maxDrawdownPct ─────────────────────────────────────────────────────────────

describe("maxDrawdownPct()", () => {
  it("returns null with fewer than 2 values", () => {
    expect(maxDrawdownPct([100])).toBeNull();
  });

  it("returns 0 for a monotonically increasing series", () => {
    expect(maxDrawdownPct([100, 110, 120])).toBe(0);
  });

  it("computes the worst peak-to-trough decline", () => {
    // Peak 120 -> trough 90 = 25% drawdown, later recovery doesn't matter
    expect(maxDrawdownPct([100, 120, 90, 115])).toBeCloseTo(0.25, 5);
  });

  it("uses the largest of multiple drawdowns, not the last one", () => {
    // First dip: 100 -> 50 (50%). Second dip: 200 -> 150 (25%). Worst is 50%.
    expect(maxDrawdownPct([100, 50, 200, 150])).toBeCloseTo(0.5, 5);
  });
});

// ── impliedTradesPerYear ───────────────────────────────────────────────────────

describe("impliedTradesPerYear()", () => {
  function trip(exitAt: string): RoundTrip {
    return {
      symbol: "AAPL", entryOrderId: "e", exitOrderId: "x",
      entryAt: exitAt, exitAt, entryPrice: 100, exitPrice: 100, qty: 1, pnl: 0, returnPct: 0,
    };
  }

  it("returns null with fewer than 2 trades", () => {
    expect(impliedTradesPerYear([trip("2024-01-01T00:00:00Z")])).toBeNull();
  });

  it("scales trade frequency up to an annual rate", () => {
    // 2 trades exactly 1 day apart -> ~730 trades/year
    const rate = impliedTradesPerYear([trip("2024-01-01T00:00:00Z"), trip("2024-01-02T00:00:00Z")]);
    expect(rate!).toBeCloseTo(365, 0);
  });
});

// ── matchRoundTrips ────────────────────────────────────────────────────────────

function fill(over: Partial<OrderFill>): OrderFill {
  return {
    id: "id", symbol: "AAPL", side: "buy", filledQty: 1, filledAvgPrice: 100,
    filledAt: "2024-01-01T00:00:00Z", assetClass: "us_equity",
    ...over,
  };
}

describe("matchRoundTrips()", () => {
  it("matches an entry to the next opposite-side fill on the same symbol", () => {
    const entry = fill({ id: "e1", side: "buy", filledAvgPrice: 100, filledAt: "2024-01-01T00:00:00Z" });
    const exit = fill({ id: "x1", side: "sell", filledAvgPrice: 110, filledAt: "2024-01-05T00:00:00Z" });
    const trips = matchRoundTrips(["e1"], [entry, exit]);
    expect(trips).toHaveLength(1);
    expect(trips[0].pnl).toBeCloseTo(10, 5);
    expect(trips[0].returnPct).toBeCloseTo(0.1, 5);
  });

  it("leaves an entry unmatched when no opposite-side fill happened after it", () => {
    const entry = fill({ id: "e1", side: "buy", filledAt: "2024-01-01T00:00:00Z" });
    expect(matchRoundTrips(["e1"], [entry])).toHaveLength(0);
  });

  it("ignores same-symbol fills for a different strategy's exit already consumed", () => {
    const e1 = fill({ id: "e1", side: "buy", filledAvgPrice: 100, filledAt: "2024-01-01T00:00:00Z" });
    const e2 = fill({ id: "e2", side: "buy", filledAvgPrice: 105, filledAt: "2024-01-02T00:00:00Z" });
    const x1 = fill({ id: "x1", side: "sell", filledAvgPrice: 110, filledAt: "2024-01-03T00:00:00Z" });
    // Both e1 and e2 are tagged to this strategy; only one sell fill exists.
    // e1 (earlier) should claim x1; e2 should be left unmatched.
    const trips = matchRoundTrips(["e1", "e2"], [e1, e2, x1]);
    expect(trips).toHaveLength(1);
    expect(trips[0].entryOrderId).toBe("e1");
  });

  it("applies the 100x options multiplier to pnl and capital", () => {
    const entry = fill({ id: "e1", side: "buy", filledAvgPrice: 2, filledAt: "2024-01-01T00:00:00Z", assetClass: "us_option" });
    const exit = fill({ id: "x1", side: "sell", filledAvgPrice: 3, filledAt: "2024-01-02T00:00:00Z", assetClass: "us_option" });
    const trips = matchRoundTrips(["e1"], [entry, exit]);
    expect(trips[0].pnl).toBeCloseTo(100, 5); // (3 - 2) * 1 contract * 100
  });

  it("handles a short entry (sell then buy to cover)", () => {
    const entry = fill({ id: "e1", side: "sell", filledAvgPrice: 100, filledAt: "2024-01-01T00:00:00Z" });
    const exit = fill({ id: "x1", side: "buy", filledAvgPrice: 90, filledAt: "2024-01-02T00:00:00Z" });
    const trips = matchRoundTrips(["e1"], [entry, exit]);
    expect(trips[0].pnl).toBeCloseTo(10, 5); // shorted at 100, covered at 90 -> profit
  });
});
