/**
 * Unit tests for runner.ts's order-hygiene helpers:
 *   - pendingOrdersFor / pendingOrderUnderlyingsFor: attribute resting (unfilled) orders to
 *     the strategy that placed them, via the same exact-symbol tag lookup groupOptionPositions
 *     uses for positions, so a slow-to-fill order still counts against maxPositions instead of
 *     letting the strategy pile up more orders than its own cap.
 *   - orderIdempotencyKey / isDuplicateClientOrderId: a deterministic client_order_id so a
 *     retried order placement (timeout, overlapping cron run) collides at Alpaca's API
 *     instead of silently placing a second real order.
 */
import { describe, it, expect } from "vitest";
import { AlpacaError } from "../alpaca";
import type { Order, Position } from "../alpaca";
import type { OrderSpec } from "./signals";
import {
  pendingOrdersFor,
  pendingOrderUnderlyingsFor,
  orderIdempotencyKey,
  isDuplicateClientOrderId,
  activePositionsFor,
} from "./runner";

function mkPosition(overrides: Partial<Position> & { symbol: string }): Position {
  return {
    qty: "1", avg_entry_price: "1", market_value: "100", unrealized_pl: "0", unrealized_plpc: "0",
    current_price: "1", side: "long", asset_class: "us_option",
    ...overrides,
  };
}

function mkOrder(overrides: Partial<Order> & { symbol: string }): Order {
  return {
    id: "ord_" + Math.random().toString(36).slice(2),
    client_order_id: "",
    qty: "1",
    filled_qty: "0",
    filled_avg_price: null,
    side: "buy",
    type: "limit",
    time_in_force: "day",
    limit_price: "1.00",
    stop_price: null,
    status: "new",
    submitted_at: new Date().toISOString(),
    filled_at: null,
    asset_class: "us_option",
    ...overrides,
  };
}

describe("pendingOrdersFor / pendingOrderUnderlyingsFor", () => {
  it("attributes an open order to its strategy via exact-symbol match", () => {
    const order = mkOrder({ symbol: "AAPL271231C00150000" });
    const tags = [
      { strategySlug: "earnings-iv-crush", symbol: "AAPL", exactSymbol: "AAPL260101C00200000" },
      { strategySlug: "vol-spread-long", symbol: "AAPL", exactSymbol: "AAPL271231C00150000" },
    ];
    expect(pendingOrdersFor([order], tags, "vol-spread-long")).toHaveLength(1);
    expect(pendingOrdersFor([order], tags, "earnings-iv-crush")).toHaveLength(0);
    expect(pendingOrderUnderlyingsFor([order], tags, "vol-spread-long")).toEqual(new Set(["AAPL"]));
  });

  it("falls back to the underlying-level lookup for legacy (exactSymbol-less) tags", () => {
    const order = mkOrder({ symbol: "ABC271231P00050000" });
    const tags = [{ strategySlug: "vrp-premium-seller", symbol: "ABC" }];
    expect(pendingOrdersFor([order], tags, "vrp-premium-seller")).toHaveLength(1);
  });

  it("does not attribute an order with no matching tag to anyone", () => {
    const order = mkOrder({ symbol: "XYZ271231C00100000" });
    expect(pendingOrdersFor([order], [], "vol-spread-long")).toHaveLength(0);
  });

  it("counts a straddle's two resting legs as two pending orders for the same strategy", () => {
    const call = mkOrder({ symbol: "NFLX271231C00700000" });
    const put  = mkOrder({ symbol: "NFLX271231P00700000" });
    const tags = [
      { strategySlug: "earnings-iv-crush", symbol: "NFLX", exactSymbol: "NFLX271231C00700000" },
      { strategySlug: "earnings-iv-crush", symbol: "NFLX", exactSymbol: "NFLX271231P00700000" },
    ];
    const pending = pendingOrdersFor([call, put], tags, "earnings-iv-crush");
    expect(pending).toHaveLength(2);
    // But only ONE distinct underlying, for the busy-check use case.
    expect(pendingOrderUnderlyingsFor([call, put], tags, "earnings-iv-crush")).toEqual(new Set(["NFLX"]));
  });

  it("attributes a resting multi-leg (mleg) combo order via its legs, not its blank top-level symbol", () => {
    // A credit spread's own top-level `symbol` is blank on a real mleg order (confirmed via
    // Alpaca forum reports) — the real option symbols only exist under `legs`. Without
    // reading `legs`, a resting credit-spread order would be invisible to the pending-order
    // count entirely, defeating the whole point of counting it against maxPositions.
    const combo = mkOrder({
      symbol: "",
      legs: [
        mkOrder({ symbol: "XLF271231C00056000" }),
        mkOrder({ symbol: "XLF271231C00057000" }),
      ],
    });
    const tags = [
      { strategySlug: "vrp-premium-short", symbol: "XLF", exactSymbol: "XLF271231C00056000" },
      { strategySlug: "vrp-premium-short", symbol: "XLF", exactSymbol: "XLF271231C00057000" },
    ];
    expect(pendingOrdersFor([combo], tags, "vrp-premium-short")).toHaveLength(1);
    expect(pendingOrderUnderlyingsFor([combo], tags, "vrp-premium-short")).toEqual(new Set(["XLF"]));
  });
});

describe("activePositionsFor", () => {
  it("does not double-count a position against a strategy that merely shares a stale same-underlying tag", () => {
    // Strategy B actually opened this AAPL position (its tag has the matching exactSymbol).
    // Strategy A also has a historical AAPL tag (e.g. a position it closed long ago, or a
    // same-underlying trade from a different cycle) — the old underlying-only match would
    // have counted this live position toward BOTH strategies' maxPositions caps.
    const pos = mkPosition({ symbol: "AAPL271231C00150000" });
    const tags = [
      { strategySlug: "strategy-a", symbol: "AAPL", exactSymbol: "AAPL260101C00200000" },
      { strategySlug: "strategy-b", symbol: "AAPL", exactSymbol: "AAPL271231C00150000" },
    ];
    expect(activePositionsFor([pos], tags, "strategy-b")).toHaveLength(1);
    expect(activePositionsFor([pos], tags, "strategy-a")).toHaveLength(0);
  });

  it("falls back to the underlying-level match for legacy (exactSymbol-less) tags", () => {
    const pos = mkPosition({ symbol: "ABC271231P00050000" });
    const tags = [{ strategySlug: "vrp-premium-seller", symbol: "ABC" }];
    expect(activePositionsFor([pos], tags, "vrp-premium-seller")).toHaveLength(1);
  });
});

describe("orderIdempotencyKey / isDuplicateClientOrderId", () => {
  const spec: OrderSpec = {
    asset: "option", symbol: "AAPL271231C00150000", underlying: "AAPL",
    side: "buy", qty: 1, orderType: "market",
  };

  it("is deterministic for the same trader/strategy/symbol/side on the same day", () => {
    const a = orderIdempotencyKey("trader1", "vol-spread-long", spec);
    const b = orderIdempotencyKey("trader1", "vol-spread-long", spec);
    expect(a).toBe(b);
  });

  it("differs for a different trader, strategy, symbol, or side", () => {
    const base = orderIdempotencyKey("trader1", "vol-spread-long", spec);
    expect(orderIdempotencyKey("trader2", "vol-spread-long", spec)).not.toBe(base);
    expect(orderIdempotencyKey("trader1", "vrp-premium-seller", spec)).not.toBe(base);
    expect(orderIdempotencyKey("trader1", "vol-spread-long", { ...spec, symbol: "TSLA271231C00300000" })).not.toBe(base);
    expect(orderIdempotencyKey("trader1", "vol-spread-long", { ...spec, side: "sell" })).not.toBe(base);
  });

  it("stays within Alpaca's 128-char client_order_id limit", () => {
    const longSpec: OrderSpec = { ...spec, symbol: "A".repeat(100) };
    expect(orderIdempotencyKey("trader-with-a-long-id-1234567890", "earnings-iv-crush", longSpec).length).toBeLessThanOrEqual(128);
  });

  it("recognizes Alpaca's duplicate client_order_id error", () => {
    expect(isDuplicateClientOrderId(new Error("client_order_id must be unique"))).toBe(true);
    expect(isDuplicateClientOrderId(new Error("Client Order ID already exists"))).toBe(true);
    expect(isDuplicateClientOrderId(new Error("spread too wide: bid $1 / ask $2"))).toBe(false);
    expect(isDuplicateClientOrderId("not an Error instance")).toBe(false);
  });

  it("does NOT treat an unrelated client_order_id validation error as a duplicate", () => {
    // Mentions the field but says nothing about it already existing/being unique — e.g. a
    // malformed-value error. Misclassifying this as "already placed" would skip the leg
    // without retrying AND without triggering rollback, silently leaving a sibling leg
    // from the same trade naked. Requiring a duplication-specific word (not just the field
    // name) is what distinguishes the two.
    expect(isDuplicateClientOrderId(new Error("client_order_id must be a string"))).toBe(false);
    expect(isDuplicateClientOrderId(new Error("invalid client_order_id: contains disallowed characters"))).toBe(false);
  });

  it("is message-based only, not gated on a specific HTTP status code", () => {
    // Deliberately NOT checking e.status here — Alpaca's actual status for this specific
    // violation was never confirmed against a real response, and a status-based gate that
    // guessed wrong would be worse than no gate at all: a genuine duplicate rejection using
    // an unexpected status would get misclassified as a NEW failure, triggering an active
    // (and wrong) cancel/close of a leg that was actually fine. The message-based check
    // (field name + duplication word) is deliberately the whole story.
    expect(isDuplicateClientOrderId(new AlpacaError(422, {}, "client order id must be unique"))).toBe(true);
    expect(isDuplicateClientOrderId(new AlpacaError(409, {}, "client_order_id already exists"))).toBe(true);
    expect(isDuplicateClientOrderId(new AlpacaError(500, {}, "client_order_id already exists"))).toBe(true);
  });
});
