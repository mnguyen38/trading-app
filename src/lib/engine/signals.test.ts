/**
 * Engine signal unit tests.
 *
 * These tests use a mocked AlpacaClient so no network calls are made.
 * They verify that:
 *   1. Signals return { fired: null, log: [...] } when conditions aren't met
 *   2. The scanner fallback universe is used when microScanList/macroEquityList is null
 *   3. Skipping logic works when all candidates are already held
 */
import { describe, it, expect, vi } from "vitest";
import type { AlpacaClient, Bar, Position } from "../alpaca";
import type { SignalContext } from "./signals";
import {
  signalVolSpreadLong,
  signalVrpPremiumSeller,
  signalQualityHold,
  signalSwingTrade,
  signalSectorRotation,
} from "./signals";
import { MICRO_UNIVERSE, MACRO_EQUITY_UNIVERSE_UNIQUE } from "./universe";

// ── Mock bar factory ──────────────────────────────────────────────────────────

function makeBars(closes: number[], count = closes.length): Bar[] {
  const padded = closes.length < count
    ? [...Array(count - closes.length).fill(closes[0]), ...closes]
    : closes;
  return padded.map((c, i) => ({
    t: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    o: c, h: c * 1.01, l: c * 0.99, c, v: 5_000_000,
  }));
}

// 260 bars at $150, enough for all indicators
const flatBars260 = makeBars(Array(260).fill(150), 260);

// ── Mock AlpacaClient ─────────────────────────────────────────────────────────

function mockAlpaca(overrides: Partial<AlpacaClient> = {}): AlpacaClient {
  return {
    getBars: vi.fn().mockResolvedValue({ bars: flatBars260 }),
    getOptionsContracts: vi.fn().mockResolvedValue({ option_contracts: [] }),
    getSnapshot: vi.fn().mockResolvedValue({ latestTrade: { p: 150 } }),
    getAccount: vi.fn(),
    getPositions: vi.fn(),
    getOrders: vi.fn(),
    getOrder: vi.fn(),
    placeOrder: vi.fn(),
    placeOptionOrder: vi.fn(),
    cancelOrder: vi.fn(),
    cancelAllOrders: vi.fn(),
    closePosition: vi.fn(),
    getPosition: vi.fn(),
    getClock: vi.fn(),
    getLatestQuote: vi.fn(),
    ...overrides,
  } as unknown as AlpacaClient;
}

// ── Base context ──────────────────────────────────────────────────────────────

function baseCtx(overrides: Partial<SignalContext> = {}): SignalContext {
  return {
    alpaca: mockAlpaca(),
    equity: 10_000,
    perPositionBudget: 1_000,
    positions: [],
    tags: [],
    stateMap: new Map(),
    microScanList: null,
    macroEquityList: null,
    ...overrides,
  };
}

// ── signalVolSpreadLong ───────────────────────────────────────────────────────

describe("signalVolSpreadLong", () => {
  it("returns no signal when getOptionsContracts returns empty (no IV estimate)", async () => {
    const ctx = baseCtx({ microScanList: ["AAPL"] });
    const result = await signalVolSpreadLong(ctx);
    expect(result.fired).toBeNull();
    expect(result.log.some(l => l.includes("could not estimate IV"))).toBe(true);
  });

  it("uses MICRO_UNIVERSE fallback when microScanList is null", async () => {
    const ctx = baseCtx({ microScanList: null });
    // With fallback universe and no contracts available, should scan but fire nothing
    const result = await signalVolSpreadLong(ctx);
    expect(result.fired).toBeNull();
    // Log line confirms it used the fallback list
    expect(result.log[0]).toContain("fallback");
  });

  it("uses scanner list when microScanList is provided", async () => {
    const ctx = baseCtx({ microScanList: ["AAPL", "TSLA"] });
    const result = await signalVolSpreadLong(ctx);
    expect(result.fired).toBeNull();
    expect(result.log[0]).toContain("scanner");
    expect(result.log[0]).toContain("2 candidates");
  });

  it("skips all when all candidates already held", async () => {
    const ctx = baseCtx({
      microScanList: ["AAPL"],
      tags: [{ strategySlug: "vol-spread-long", symbol: "AAPL" }],
      positions: [{ symbol: "AAPL", qty: "1", avg_entry_price: "150", market_value: "150",
        unrealized_pl: "0", unrealized_plpc: "0", current_price: "150", side: "long" }],
    });
    const result = await signalVolSpreadLong(ctx);
    expect(result.fired).toBeNull();
    expect(result.log[0]).toContain("at max positions");
  });
});

// ── signalVrpPremiumSeller ────────────────────────────────────────────────────

describe("signalVrpPremiumSeller", () => {
  it("returns no signal when no contracts available", async () => {
    const ctx = baseCtx({ microScanList: ["NVDA"] });
    const result = await signalVrpPremiumSeller(ctx);
    expect(result.fired).toBeNull();
    expect(result.log.some(l => l.includes("could not estimate IV"))).toBe(true);
  });

  it("falls back to MICRO_UNIVERSE when microScanList is null", async () => {
    const ctx = baseCtx({ microScanList: null });
    const result = await signalVrpPremiumSeller(ctx);
    expect(result.fired).toBeNull();
    expect(result.log[0]).toContain("fallback");
  });
});

// ── signalQualityHold ─────────────────────────────────────────────────────────

describe("signalQualityHold", () => {
  it("uses MACRO_EQUITY_UNIVERSE_UNIQUE as fallback when macroEquityList is null", async () => {
    const ctx = baseCtx({ macroEquityList: null });
    const result = await signalQualityHold(ctx);
    // flat bars = no drawdown → no signal, but fallback list is used
    expect(result.fired).toBeNull();
    expect(result.log[0]).toContain("fallback");
    expect(result.log[0]).toContain(`${MACRO_EQUITY_UNIVERSE_UNIQUE.length} candidates`);
  });

  it("uses scanner list when macroEquityList is provided", async () => {
    const ctx = baseCtx({ macroEquityList: ["AAPL", "MSFT"] });
    const result = await signalQualityHold(ctx);
    expect(result.fired).toBeNull();
    expect(result.log[0]).toContain("scanner");
    expect(result.log[0]).toContain("2 candidates");
  });

  it("fires when stock is 10-20% below 52w high", async () => {
    // Bars: 250 at $150 (52w high), then last 10 at $130 (13.3% drawdown → in 10-20% zone)
    const dipBars = makeBars([...Array(250).fill(150), ...Array(10).fill(130)], 260);
    const ctx = baseCtx({
      macroEquityList: ["AAPL"],
      alpaca: mockAlpaca({ getBars: vi.fn().mockResolvedValue({ bars: dipBars }) }),
    });
    const result = await signalQualityHold(ctx);
    expect(result.fired).not.toBeNull();
    expect(result.fired?.strategySlug).toBe("quality-hold");
    expect(result.fired?.orders[0].side).toBe("buy");
  });

  it("does not fire when stock is less than 10% below 52w high (no dip)", async () => {
    // Bars: flat at $150 → no drawdown
    const ctx = baseCtx({ macroEquityList: ["AAPL"] });
    const result = await signalQualityHold(ctx);
    expect(result.fired).toBeNull();
    expect(result.log.some(l => l.includes("need 10–20% dip"))).toBe(true);
  });

  it("does not fire when stock is more than 20% below 52w high (too deep)", async () => {
    const deepDipBars = makeBars([...Array(250).fill(150), ...Array(10).fill(100)], 260);
    const ctx = baseCtx({
      macroEquityList: ["AAPL"],
      alpaca: mockAlpaca({ getBars: vi.fn().mockResolvedValue({ bars: deepDipBars }) }),
    });
    const result = await signalQualityHold(ctx);
    expect(result.fired).toBeNull();
    expect(result.log.some(l => l.includes("too deep"))).toBe(true);
  });
});

// ── signalSwingTrade ──────────────────────────────────────────────────────────

describe("signalSwingTrade", () => {
  it("falls back to MACRO_EQUITY_UNIVERSE_UNIQUE when macroEquityList is null", async () => {
    const ctx = baseCtx({ macroEquityList: null });
    const result = await signalSwingTrade(ctx);
    expect(result.fired).toBeNull();
    expect(result.log[0]).toContain("fallback");
  });

  it("skips stocks below 50MA", async () => {
    // Price starts at 200, trends down to 100 → below 50MA
    const downBars = makeBars(Array.from({ length: 260 }, (_, i) => 200 - i * 0.4), 260);
    const ctx = baseCtx({
      macroEquityList: ["TSLA"],
      alpaca: mockAlpaca({ getBars: vi.fn().mockResolvedValue({ bars: downBars }) }),
    });
    const result = await signalSwingTrade(ctx);
    expect(result.fired).toBeNull();
    expect(result.log.some(l => l.includes("not in uptrend"))).toBe(true);
  });
});

// ── signalSectorRotation (ETF lists are always fixed) ─────────────────────────

describe("signalSectorRotation", () => {
  it("returns no signal when already rotated this month", async () => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    const ctx = baseCtx({
      stateMap: new Map([["sector-rotation::last_rot_month", thisMonth]]),
    });
    const result = await signalSectorRotation(ctx);
    expect(result.fired).toBeNull();
    expect(result.log[0]).toContain("monthly cooldown");
  });

  it("skips ETFs below 50MA", async () => {
    // Flat bars at $150 → no trend, SMA50 = 150, price = 150 → price NOT > ma50 → skip
    // (price <= ma50 since they're equal — need strictly above)
    const ctx = baseCtx(); // flat bars from mockAlpaca
    const result = await signalSectorRotation(ctx);
    // Either no ETFs pass the 50MA filter OR already held — either way no signal
    expect(result.fired).toBeNull();
  });
});
