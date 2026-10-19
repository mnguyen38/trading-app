/**
 * Engine signal unit tests.
 *
 * These tests use a mocked AlpacaClient so no network calls are made.
 * They verify that:
 *   1. Signals return { fired: null, log: [...] } when conditions aren't met
 *   2. The scanner fallback universe is used when microScanList/macroEquityList is null
 *   3. Skipping logic works when all candidates are already held
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { AlpacaClient, Bar, OptionContract, Position } from "../alpaca";
import type { SignalContext } from "./signals";
import {
  signalVolSpreadLong,
  signalRsiReversal,
  signalVrpPremiumShort,
  signalVrpInversionLong,
  signalQualityHold,
  signalSwingTrade,
  signalSectorRotation,
  checkMicroExits,
  checkVrpPremiumShortExits,
  checkLegacyEquityExits,
  selectLegacyEquitySlotExits,
  sizeWithinBudget,
} from "./signals";
import { MICRO_UNIVERSE, MACRO_EQUITY_UNIVERSE_UNIQUE } from "./universe";

// ── Mock bar factory ──────────────────────────────────────────────────────────

function makeBars(closes: number[], count = closes.length): Bar[] {
  const padded = closes.length < count
    ? [...Array(count - closes.length).fill(closes[0]), ...closes]
    : closes;
  // Anchored to Date.now(), one day per bar back from "today" — NOT sequential day-of-month
  // numbers in a fixed "2024-01-XX" string. The old scheme produced invalid dates like
  // "2024-01-260" for any count over 31 (String(i+1).padStart(2,"0") doesn't truncate a
  // 3-digit day back down to a valid calendar date). That was silently tolerated before the
  // staleness guard's NaN-fail-open bug was fixed — bars() treated an unparseable age as
  // "not stale" rather than stale. Fixing that bug (correctly) now rejects these bars unless
  // their dates are real and recent.
  const now = Date.now();
  return padded.map((c, i) => ({
    t: new Date(now - (padded.length - 1 - i) * 86_400_000).toISOString(),
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
    getCalendar: vi.fn().mockResolvedValue([]),
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
    optionsBuyingPower: 50_000,
    positions: [],
    tags: [],
    pendingOrderUnderlyings: new Set(),
    stateMap: new Map(),
    microScanList: null,
    macroEquityList: null,
    ...overrides,
  };
}

// ── sizeWithinBudget ────────────────────────────────────────────────────────────

describe("sizeWithinBudget", () => {
  it("floors to whole units when the budget comfortably covers more than one", () => {
    expect(sizeWithinBudget(1000, 300)).toBe(3);
  });

  it("rounds up to 1 when a single unit is within the over-budget tolerance", () => {
    // $1,100 unit cost vs $1,000 budget = 10% over — within the default 25% tolerance.
    expect(sizeWithinBudget(1000, 1100)).toBe(1);
  });

  it("refuses the trade when even 1 unit blows far past the budget", () => {
    // $1,800 unit cost vs $1,000 budget = 80% over — the bug this fixes: the old
    // Math.max(1, ...) code would have forced a 1-unit buy here regardless.
    expect(sizeWithinBudget(1000, 1800)).toBeNull();
  });

  it("treats zero or negative cost/budget as unsizeable", () => {
    expect(sizeWithinBudget(1000, 0)).toBeNull();
    expect(sizeWithinBudget(0, 100)).toBeNull();
    expect(sizeWithinBudget(1000, -50)).toBeNull();
  });
});

// ── signalVrpPremiumShort ────────────────────────────────────────────────────────

describe("signalVrpPremiumShort", () => {
  function wigglyClosesFor(targetHvPct: number, start = 100, count = 40): number[] {
    const dailySigma = targetHvPct / 100 / Math.sqrt(252);
    const out: number[] = [];
    let price = start;
    for (let i = 0; i < count; i++) {
      price *= Math.exp(i % 2 === 0 ? dailySigma : -dailySigma);
      out.push(price);
    }
    return out;
  }

  function barsFromCloses(closes: number[]): Bar[] {
    const now = Date.now();
    return closes.map((c, i) => ({
      t: new Date(now - (closes.length - 1 - i) * 86_400_000).toISOString(),
      o: c, h: c * 1.01, l: c * 0.99, c, v: 1_000_000,
    }));
  }

  // A full strike ladder for one underlying ("TST") at one ~38-DTE expiry — only the ATM
  // ($100) strike is "priced" (has a close_price), which is enough for estimateIV's ATM
  // straddle AND for selectStrangleStrikes/selectShortPremiumStructure to find OTM short
  // strikes and a further-OTM wing from the surrounding strikes in the ladder.
  function mockShortPremiumAlpaca(tstBars: Bar[], spyFlat = true): AlpacaClient {
    const expiryISO = new Date(Date.now() + 38 * 86_400_000).toISOString().slice(0, 10);
    const expiryOCC = expiryISO.slice(2).replace(/-/g, "");
    const occStrike = (s: number) => String(Math.round(s * 1000)).padStart(8, "0");
    const strikes = [80, 85, 90, 95, 100, 105, 110, 115, 120, 125];

    function contract(strike: number, type: "call" | "put", closePrice: string | null): OptionContract {
      return {
        id: `${type}${strike}`,
        symbol: `TST${expiryOCC}${type === "call" ? "C" : "P"}${occStrike(strike)}`,
        underlying_symbol: "TST",
        type,
        expiration_date: expiryISO,
        strike_price: strike.toFixed(2),
        open_interest: "100",
        close_price: closePrice,
      };
    }
    // ATM straddle priced to read back ~50% IV (sqrt(pi/2T) * straddle/S *100, T=38/365).
    const calls = strikes.map(s => contract(s, "call", s === 100 ? "6.50" : null));
    const puts  = strikes.map(s => contract(s, "put",  s === 100 ? "6.40" : null));

    const spyBars = barsFromCloses(Array(60).fill(spyFlat ? 100 : 0).map((v, i) => spyFlat ? 100 : 100 + i * 0.1));

    return {
      getBars: async (symbol: string) => ({ bars: symbol === "SPY" ? spyBars : tstBars }),
      getOptionsContracts: async (_underlying: string, opts: { type?: "call" | "put" }) => ({
        option_contracts: opts.type === "put" ? puts : calls,
        next_page_token: null,
      }),
      getOptionsSnapshots: async () => ({ snapshots: {} }),
    } as unknown as AlpacaClient;
  }

  it("sells a credit call spread when SPY is flat/below its 50MA (no stock required)", async () => {
    const ctx = baseCtx({
      microScanList: ["TST"],
      perPositionBudget: 2_000,
      optionsBuyingPower: 50_000,
      alpaca: mockShortPremiumAlpaca(barsFromCloses(wigglyClosesFor(20))), // HV30 ≈ 20%, well under the ~50% IV
    });
    const result = await signalVrpPremiumShort(ctx);
    expect(result.fired).not.toBeNull();
    const order = result.fired!.orders[0];
    expect(order.asset).toBe("option_spread");
    expect(order.side).toBe("sell");
    expect(order.legs).toHaveLength(2);
    expect(order.legs![0]).toMatchObject({ side: "sell", positionIntent: "sell_to_open" });
    expect(order.legs![1]).toMatchObject({ side: "buy", positionIntent: "buy_to_open" });
    // Wing (long leg) must be a HIGHER strike than the short leg, same expiry — the whole
    // point of the construction (this is the bug the live-data check against real Alpaca
    // option chains caught: an earlier version of the collateral math had the subtraction
    // backwards, which would have sized every credit spread as "always too expensive").
    expect(order.legs![1].symbol > order.legs![0].symbol).toBe(true);
    // collateral = (115-110)*100 = $500 -> qty = floor(min(2000, 50000) / 500) = 4
    expect(order.qty).toBe(4);
  });

  it("sells a cash-secured put when SPY is above its 50MA (no stock required either)", async () => {
    // Needs a much bigger budget than the spread case — CSP collateral is the FULL $90
    // strike × 100 = $9,000, not a spread width like the credit-spread scenario above.
    const ctx = baseCtx({
      microScanList: ["TST"],
      perPositionBudget: 10_000,
      optionsBuyingPower: 50_000,
      alpaca: mockShortPremiumAlpaca(barsFromCloses(wigglyClosesFor(20)), false),
    });
    const result = await signalVrpPremiumShort(ctx);
    expect(result.fired).not.toBeNull();
    const order = result.fired!.orders[0];
    expect(order.asset).toBe("option");
    expect(order.side).toBe("sell");
    expect(order.symbol).toContain("P"); // a put, not a call
  });

  it("skips when IV is not rich enough relative to HV30", async () => {
    const ctx = baseCtx({
      microScanList: ["TST"],
      alpaca: mockShortPremiumAlpaca(barsFromCloses(wigglyClosesFor(80))), // HV30 ≈ 80%, well above the ~50% IV
    });
    const result = await signalVrpPremiumShort(ctx);
    expect(result.fired).toBeNull();
    expect(result.log.some(l => l.includes("vol not rich enough"))).toBe(true);
  });

  it("skips on budget when even 1 contract's collateral exceeds the available budget", async () => {
    const ctx = baseCtx({
      microScanList: ["TST"],
      perPositionBudget: 100, // $500 spread collateral >> $100 budget
      optionsBuyingPower: 100,
      alpaca: mockShortPremiumAlpaca(barsFromCloses(wigglyClosesFor(20))),
    });
    const result = await signalVrpPremiumShort(ctx);
    expect(result.fired).toBeNull();
    expect(result.log.some(l => l.includes("collateral exceeds"))).toBe(true);
  });

  it("skips all when all candidates already held", async () => {
    const ctx = baseCtx({
      microScanList: ["TST"],
      tags: [{ strategySlug: "vrp-premium-short", symbol: "TST" }],
      positions: [{ symbol: "TST", qty: "1", avg_entry_price: "100", market_value: "100",
        unrealized_pl: "0", unrealized_plpc: "0", current_price: "100", side: "short" }],
    });
    const result = await signalVrpPremiumShort(ctx);
    expect(result.fired).toBeNull();
    expect(result.log[0]).toContain("at max positions");
  });
});

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

// ── signalRsiReversal ─────────────────────────────────────────────────────────

describe("signalRsiReversal", () => {
  it("returns no signal when no contracts available", async () => {
    // flatBars260 is a flat price series -> RSI(14) = 100 (overbought extreme),
    // so this exercises the "signal fires but no contracts" path, not a neutral-RSI skip.
    const ctx = baseCtx({ microScanList: ["NVDA"] });
    const result = await signalRsiReversal(ctx);
    expect(result.fired).toBeNull();
    expect(result.log.some(l => l.includes("no ATM contracts available"))).toBe(true);
  });

  it("falls back to MICRO_UNIVERSE when microScanList is null", async () => {
    const ctx = baseCtx({ microScanList: null });
    const result = await signalRsiReversal(ctx);
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

// ── checkLegacyEquityExits ───────────────────────────────────────────────────

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    symbol: "TST", qty: "100", avg_entry_price: "100", market_value: "10000",
    unrealized_pl: "0", unrealized_plpc: "0", current_price: "100",
    side: "long", asset_class: "us_equity",
    ...overrides,
  };
}

// Builds a daily bar series whose log-return stdev (annualised × √252) ≈ the given HV30%.
// Alternates +d/-d around a flat base so the mean return stays ~0 and the realised
// stdev converges to the target.
function barsForHv(targetHvPct: number, count = 40): Bar[] {
  const dailySigma = targetHvPct / 100 / Math.sqrt(252);
  const now = Date.now();
  let price = 100;
  const out: Bar[] = [];
  for (let i = 0; i < count; i++) {
    const r = i % 2 === 0 ? dailySigma : -dailySigma;
    price *= Math.exp(r);
    // Dated relative to whenever this test actually runs, ending at "today" — not a fixed
    // calendar date, which bars()'s staleness guard (signals.ts) would reject once enough
    // real time has passed, silently falling back to flat/no-data behavior instead of
    // failing loudly.
    out.push({ t: new Date(now - (count - 1 - i) * 86_400_000).toISOString(), o: price, h: price, l: price, c: price, v: 1_000_000 });
  }
  return out;
}

function mockAlpacaForBars(bySymbol: Record<string, Bar[]>): AlpacaClient {
  return {
    getBars: vi.fn(async (symbol: string) => ({ bars: bySymbol[symbol] ?? [] })),
  } as unknown as AlpacaClient;
}

describe("checkLegacyEquityExits", () => {
  it("ignores options positions entirely", async () => {
    const pos = makePosition({ asset_class: "us_option", unrealized_plpc: "0.50" });
    const exits = await checkLegacyEquityExits(mockAlpacaForBars({}), [pos]);
    expect(exits).toHaveLength(0);
  });

  it("does not exit a high-vol stock inside its wider band", async () => {
    // HV30 ~90% (MSTR-like) -> stop well beyond -20%, so -10% should NOT exit
    const pos = makePosition({ symbol: "MSTR", unrealized_plpc: "-0.10" });
    const exits = await checkLegacyEquityExits(mockAlpacaForBars({ MSTR: barsForHv(90) }), [pos]);
    expect(exits).toHaveLength(0);
  });

  it("exits a high-vol stock once it clears its wider stop", async () => {
    const pos = makePosition({ symbol: "MSTR", unrealized_plpc: "-0.40" });
    const exits = await checkLegacyEquityExits(mockAlpacaForBars({ MSTR: barsForHv(90) }), [pos]);
    expect(exits).toHaveLength(1);
    expect(exits[0].reason).toContain("stop loss");
  });

  it("exits a low-vol stock on a much smaller move than a high-vol one needs", async () => {
    // HV30 ~18% (JNJ-like) -> stop clamps to the -8% floor, so -9% should exit
    const pos = makePosition({ symbol: "JNJ", unrealized_plpc: "-0.09" });
    const exits = await checkLegacyEquityExits(mockAlpacaForBars({ JNJ: barsForHv(18) }), [pos]);
    expect(exits).toHaveLength(1);
    expect(exits[0].reason).toContain("stop loss");
  });

  it("falls back to a flat band when HV30 can't be computed", async () => {
    const pos = makePosition({ symbol: "NEW", unrealized_plpc: "-0.15" });
    const exits = await checkLegacyEquityExits(mockAlpacaForBars({ NEW: [] }), [pos]);
    expect(exits).toHaveLength(1);
    expect(exits[0].reason).toContain("fallback");
  });
});

// ── selectLegacyEquitySlotExits ──────────────────────────────────────────────

describe("selectLegacyEquitySlotExits", () => {
  it("returns nothing when count is 0", async () => {
    const pos = makePosition({ symbol: "A", unrealized_plpc: "0.05" });
    const exits = await selectLegacyEquitySlotExits(mockAlpacaForBars({ A: barsForHv(18) }), [pos], 0);
    expect(exits).toHaveLength(0);
  });

  it("frees the winner closest to its target first, capped at the requested count", async () => {
    const positions = [
      makePosition({ symbol: "A_near", unrealized_plpc: "0.14" }),
      makePosition({ symbol: "B_far",  unrealized_plpc: "0.03" }),
      makePosition({ symbol: "C_loss", unrealized_plpc: "-0.02" }),
    ];
    const alpaca = mockAlpacaForBars({ A_near: barsForHv(18), B_far: barsForHv(18), C_loss: barsForHv(18) });
    const exits = await selectLegacyEquitySlotExits(alpaca, positions, 1);
    expect(exits).toHaveLength(1);
    expect(exits[0].positionSymbol).toBe("A_near");
  });

  it("ignores options positions", async () => {
    const pos = makePosition({ symbol: "OPT", asset_class: "us_option", unrealized_plpc: "0.50" });
    const exits = await selectLegacyEquitySlotExits(mockAlpacaForBars({}), [pos], 1);
    expect(exits).toHaveLength(0);
  });
});

// ── checkMicroExits / checkEarningsStraddleExits (combined-leg trade management) ────

// Far-future expiry so these fixtures test P&L logic, not the DTE time stop.
const FAR_EXPIRY = "291231";

function daysFromNowISO(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}
function occDateFromNow(n: number): string {
  return daysFromNowISO(n).slice(2).replace(/-/g, "");
}

function mkOption(overrides: Partial<Position> & { symbol: string }): Position {
  return {
    qty: "1", avg_entry_price: "1", market_value: "100", unrealized_pl: "0", unrealized_plpc: "0",
    current_price: "1", side: "long", asset_class: "us_option",
    ...overrides,
  };
}

describe("checkMicroExits (straddle legs evaluated together, not independently)", () => {
  it("keeps a straddle open when legs offset even though each alone would trip the old per-leg rule", () => {
    // cost = (2+2)*100 = $400; pl = 100 + (-80) = $20 -> combined +5%, well inside the band.
    // unrealized_plpc set to match what each leg's OWN pl/cost works out to (+50%/-40%) —
    // that's the field the OLD per-leg code read directly (parseFloat(pos.unrealized_plpc)),
    // so this fixture actually represents "each leg alone would have tripped the old rule",
    // not just a comment claiming it does.
    const call = mkOption({ symbol: `XYZ${FAR_EXPIRY}C00100000`, avg_entry_price: "2", market_value: "300", unrealized_pl: "100", unrealized_plpc: "0.50" });
    const put  = mkOption({ symbol: `XYZ${FAR_EXPIRY}P00100000`, avg_entry_price: "2", market_value: "120", unrealized_pl: "-80", unrealized_plpc: "-0.40" });
    const exits = checkMicroExits([call, put], [{ strategySlug: "vol-spread-long", symbol: "XYZ" }]);
    expect(exits).toHaveLength(0);
  });

  it("closes both legs together once the straddle's combined P&L crosses the profit target", () => {
    // cost = $400; pl = 150 + 50 = $200 -> combined +50%; per-leg plpc set to match (+75%/+25%).
    const call = mkOption({ symbol: `XYZ${FAR_EXPIRY}C00100000`, avg_entry_price: "2", market_value: "350", unrealized_pl: "150", unrealized_plpc: "0.75" });
    const put  = mkOption({ symbol: `XYZ${FAR_EXPIRY}P00100000`, avg_entry_price: "2", market_value: "250", unrealized_pl: "50", unrealized_plpc: "0.25" });
    const exits = checkMicroExits([call, put], [{ strategySlug: "vol-spread-long", symbol: "XYZ" }]);
    expect(exits).toHaveLength(2);
    expect(exits.every(e => e.reason.includes("2-leg trade"))).toBe(true);
  });

  it("still applies the stop loss normally to a single-leg directional trade", () => {
    const put = mkOption({ symbol: `ABC${FAR_EXPIRY}P00050000`, qty: "2", avg_entry_price: "1", market_value: "140", unrealized_pl: "-60" });
    const exits = checkMicroExits([put], [{ strategySlug: "vrp-premium-seller", symbol: "ABC" }]);
    expect(exits).toHaveLength(1);
    expect(exits[0].reason).toContain("stop loss");
  });

  it("no longer touches vrp-premium-short positions at all (handled by checkVrpPremiumShortExits)", () => {
    const shortCall = mkOption({ symbol: `NFLX${FAR_EXPIRY}C00071000`, side: "short", avg_entry_price: "3", market_value: "250", unrealized_pl: "50" });
    const longCall  = mkOption({ symbol: `NFLX${FAR_EXPIRY}C00076000`, side: "long",  avg_entry_price: "1", market_value: "90",  unrealized_pl: "-10" });
    const exits = checkMicroExits([shortCall, longCall], [{ strategySlug: "vrp-premium-short", symbol: "NFLX" }]);
    expect(exits).toHaveLength(0);
  });
});

describe("checkVrpPremiumShortExits (short-premium thresholds: 50% target / -100% stop / 14 DTE)", () => {
  const tags = [{ strategySlug: "vrp-premium-short", symbol: "NFLX" }];

  // A credit call spread: short the near strike ($3 premium = $300), long the further-OTM
  // wing ($1 premium = $100). The basis for shortPremiumPlpc is the NET CREDIT received —
  // $300 − $100 = $200 — NOT the sum of both legs' gross premiums ($400). Using the gross
  // sum would make the +50% profit target mathematically unreachable whenever the wing
  // costs more than ~1/3 of the short leg (max achievable profit on this spread is the
  // $200 net credit, which is only 50% of a $400 basis) — this was a real bug, caught by a
  // quant review walking through the exact arithmetic.
  function creditSpread(shortCallPl: number, longCallPl: number, expiry = FAR_EXPIRY) {
    return [
      mkOption({ symbol: `NFLX${expiry}C00071000`, side: "short", avg_entry_price: "3", market_value: String(300 + shortCallPl), unrealized_pl: String(shortCallPl) }),
      mkOption({ symbol: `NFLX${expiry}C00076000`, side: "long",  avg_entry_price: "1", market_value: String(100 + longCallPl),  unrealized_pl: String(longCallPl) }),
    ];
  }

  it("stays open when combined P&L is well inside the band", () => {
    // combined pl = 50 - 10 = 40 -> +20% of the $200 net-credit basis, inside both thresholds.
    expect(checkVrpPremiumShortExits(creditSpread(50, -10), tags)).toHaveLength(0);
  });

  it("closes both legs once 50% of the credit captured is hit", () => {
    // combined pl = 150 - 50 = 100 -> +50% of the $200 net-credit basis, profit target.
    const exits = checkVrpPremiumShortExits(creditSpread(150, -50), tags);
    expect(exits).toHaveLength(2);
    expect(exits[0].reason).toContain("profit target");
  });

  it("closes both legs at the -100% stop (credit lost roughly doubled against us)", () => {
    // combined pl = -250 + 50 = -200 -> -100% of the $200 net-credit basis, stop loss.
    const exits = checkVrpPremiumShortExits(creditSpread(-250, 50), tags);
    expect(exits).toHaveLength(2);
    expect(exits[0].reason).toContain("stop loss");
  });

  it("time-stops at 14 DTE even with flat P&L — tighter than checkMicroExits's 21-DTE, to avoid assignment risk", () => {
    const occDate = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(2, 10).replace(/-/g, "");
    const exits = checkVrpPremiumShortExits(creditSpread(0, 0, occDate(10)), tags);
    expect(exits).toHaveLength(2);
    expect(exits[0].reason).toContain("DTE");
  });

  it("does not time-stop at 16 DTE — inside the 14-DTE threshold, outside checkMicroExits's 21", () => {
    const occDate = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(2, 10).replace(/-/g, "");
    expect(checkVrpPremiumShortExits(creditSpread(0, 0, occDate(16)), tags)).toHaveLength(0);
  });

  it("applies the same thresholds to a standalone cash-secured put (single leg, no spread)", () => {
    const shortPut = mkOption({ symbol: `NFLX${FAR_EXPIRY}P00060000`, side: "short", avg_entry_price: "2", market_value: "100", unrealized_pl: "100" });
    // combined pl = 100 on cost basis |2*1|*100 = 200 -> +50%, profit target.
    const exits = checkVrpPremiumShortExits([shortPut], tags);
    expect(exits).toHaveLength(1);
    expect(exits[0].reason).toContain("profit target");
  });
});

describe("exact-symbol tag attribution (fixes cross-strategy collision)", () => {
  // Same underlying tagged by two different strategies — the old underlying-only lookup
  // (tags.find by symbol) picked whichever row happened to come first in the (unordered)
  // tags array, which could merge this vol-spread-long straddle into the wrong strategy's
  // exit group, or — for earnings-iv-crush specifically — leave it vulnerable to a stale,
  // never-cleared state left behind by an earlier, unrelated trade in the same underlying.
  // exactSymbol routes each leg to the strategy that actually opened it.
  const expiry = occDateFromNow(10);

  it("routes a straddle to its real strategy, not a stale same-underlying tag from another strategy", () => {
    const call = mkOption({ symbol: `AAPL${expiry}C00150000`, avg_entry_price: "2", market_value: "350", unrealized_pl: "150" });
    const put  = mkOption({ symbol: `AAPL${expiry}P00150000`, avg_entry_price: "2", market_value: "250", unrealized_pl: "50" });
    const tags = [
      // A stale vrp-premium-short row for the same underlying, left over from an earlier,
      // unrelated trade — this is exactly the row the old underlying-only lookup could have
      // picked, which would have routed this straddle through checkVrpPremiumShortExits's
      // 50%/-100%/14-DTE thresholds instead of its real strategy's own.
      { strategySlug: "vrp-premium-short", symbol: "AAPL", exactSymbol: "AAPL260101C00071000" },
      // The real tags for THIS straddle's two legs.
      { strategySlug: "vol-spread-long", symbol: "AAPL", exactSymbol: `AAPL${expiry}C00150000` },
      { strategySlug: "vol-spread-long", symbol: "AAPL", exactSymbol: `AAPL${expiry}P00150000` },
    ];
    // Must NOT be claimed by checkVrpPremiumShortExits just because a vrp-premium-short tag
    // also exists for "AAPL" — this straddle was never opened by that strategy.
    expect(checkVrpPremiumShortExits([call, put], tags)).toHaveLength(0);

    // checkMicroExits correctly evaluates it under vol-spread-long's own combined P&L
    // (cost $400, pl $200 -> +50%, profit target) instead of leaving it unmanaged.
    const exits = checkMicroExits([call, put], tags);
    expect(exits).toHaveLength(2);
    expect(exits.every(e => e.strategySlug === "vol-spread-long")).toBe(true);
  });

  it("still falls back to the old underlying-level lookup for legacy rows with no exactSymbol", () => {
    // A position opened before this fix shipped has no exactSymbol anywhere for it — the
    // only sane behavior left is the pre-fix underlying-level match, so legacy positions
    // stay managed (not silently orphaned) even though the ambiguity isn't fully resolved.
    const put = mkOption({ symbol: `ABC${expiry}P00050000`, qty: "2", avg_entry_price: "1", market_value: "140", unrealized_pl: "-60" });
    const exits = checkMicroExits([put], [{ strategySlug: "vrp-premium-seller", symbol: "ABC" }]);
    expect(exits).toHaveLength(1);
    expect(exits[0].reason).toContain("stop loss");
  });
});

// ── signalVrpInversionLong streak counting (once per trading day, not per 5-min run) ──

describe("signalVrpInversionLong streak", () => {
  const RealDate = Date;
  afterEach(() => { globalThis.Date = RealDate; });

  function setFakeDate(iso: string) {
    class FakeDate extends RealDate {
      constructor(...a: ConstructorParameters<typeof Date>) { a.length ? super(...a) : super(iso); }
      static now() { return new RealDate(iso).getTime(); }
    }
    globalThis.Date = FakeDate as DateConstructor;
  }

  // Bars dated relative to "now" as the code under test sees it — i.e. Date.now(), which
  // resolves through whatever's currently installed on globalThis.Date (the FakeDate set by
  // setFakeDate below once a test is running). Deliberately NOT RealDate.now(): an earlier
  // version of this helper anchored to the real wall clock while runOnDate simulates dates
  // in the past relative to it, so bars() computed a NEGATIVE age (a "future" bar relative
  // to the simulated day) and slipped past the staleness guard by sign rather than by
  // actually being fresh — the test wasn't exercising realistic date relationships.
  function barsEndingNow(closes: number[]): Bar[] {
    const now = Date.now();
    return closes.map((c, i) => ({
      t: new RealDate(now - (closes.length - 1 - i) * 86_400_000).toISOString(),
      o: c, h: c * 1.01, l: c * 0.99, c, v: 1_000_000,
    }));
  }
  // Alternating up/down closes -> HV30 > 0 (unlike a flat series, which gives HV30 = 0 and
  // can never show an inversion against any positive IV).
  function wigglyCloses(base: number, amp: number, count = 260): number[] {
    const out = [base];
    for (let i = 1; i < count; i++) out.push(out[i - 1] * (i % 2 === 0 ? 1 + amp : 1 / (1 + amp)));
    return out;
  }

  function mockStreakAlpaca(ivPercent: number | null, tstBars: Bar[], calendarDates: string[] = []): AlpacaClient {
    const T = 38 / 365;
    const expiry = new RealDate(Date.now() + 38 * 86_400_000).toISOString().slice(0, 10);
    // Strike pinned to this run's actual last close, not a fixed "100" — the wiggly series
    // doesn't necessarily end near its starting price, and nearestPricedPair only matches
    // within ±7% of the current price.
    const lastClose = tstBars.at(-1)!.c;
    return {
      getBars: async (symbol: string) => ({ bars: symbol === "SPY" ? barsEndingNow(Array(60).fill(100)) : tstBars }),
      getOptionsContracts: async (_u: string, o: { type?: "call" | "put" }) => {
        if (ivPercent === null) return { option_contracts: [], next_page_token: null };
        const straddle = (ivPercent / 100) * Math.sqrt((2 * T) / Math.PI) * lastClose;
        const leg: OptionContract = {
          id: "1", symbol: "TSTX", underlying_symbol: "TST", type: o.type ?? "call",
          expiration_date: expiry, strike_price: lastClose.toFixed(2), open_interest: "100",
          close_price: (straddle / 2).toFixed(4),
        };
        return { option_contracts: [leg], next_page_token: null };
      },
      getOptionsSnapshots: async () => ({ snapshots: {} }),
      getCalendar: async (start: string, end: string) =>
        calendarDates.filter(d => d >= start && d <= end).map(date => ({ date, open: "09:30", close: "16:00" })),
    } as unknown as AlpacaClient;
  }

  async function runOnDate(iso: string, stateMap: Map<string, string>, ivPercent: number | null, calendarDates: string[] = []) {
    setFakeDate(iso);
    const tstBars = barsEndingNow(wigglyCloses(100, 0.08));
    const ctx = {
      alpaca: mockStreakAlpaca(ivPercent, tstBars, calendarDates), equity: 100_000, perPositionBudget: 2_000,
      positions: [], tags: [], stateMap, microScanList: ["TST"], macroEquityList: null,
    } as SignalContext;
    const result = await signalVrpInversionLong(ctx);
    for (const u of result.fired?.stateUpdates ?? []) stateMap.set(u.key, u.value);
    // Simulates runner.ts applying postOrderStateUpdates once the order is confirmed
    // placed — these tests don't model order failures, so applying it unconditionally here
    // (mirroring the "order succeeded" path) is the right stand-in.
    for (const u of result.fired?.postOrderStateUpdates ?? []) stateMap.set(u.key, u.value);
    return result;
  }

  // This wiggly series' HV30 is high (large alternating moves); a low ivPercent (10)
  // reliably reads as HV > IV, i.e. an inversion day, for every check below.

  it("does not double-count a second run on the same day", async () => {
    const stateMap = new Map<string, string>();
    await runOnDate("2026-02-02T15:00:00Z", stateMap, 10);
    expect(stateMap.get("vrp-inversion-long:TST:streak")).toBe("1");
    await runOnDate("2026-02-02T15:05:00Z", stateMap, 10);
    expect(stateMap.get("vrp-inversion-long:TST:streak")).toBe("1"); // still 1, not 2
  });

  it("advances the streak once per new day", async () => {
    const stateMap = new Map<string, string>();
    await runOnDate("2026-02-02T15:00:00Z", stateMap, 10);
    await runOnDate("2026-02-03T15:00:00Z", stateMap, 10);
    expect(stateMap.get("vrp-inversion-long:TST:streak")).toBe("2");
  });

  it("does not reset the streak on an IV fetch failure, and does not advance the date", async () => {
    const stateMap = new Map<string, string>([
      ["vrp-inversion-long:TST:streak", "2"],
      ["vrp-inversion-long:TST:streak_date", "2026-02-01"],
    ]);
    await runOnDate("2026-02-02T15:00:00Z", stateMap, null);
    expect(stateMap.get("vrp-inversion-long:TST:streak")).toBe("2");
    expect(stateMap.get("vrp-inversion-long:TST:streak_date")).toBe("2026-02-01");
  });

  it("resets the streak on a genuinely non-inverted day", async () => {
    const stateMap = new Map<string, string>([
      ["vrp-inversion-long:TST:streak", "2"],
      ["vrp-inversion-long:TST:streak_date", "2026-02-01"],
    ]);
    // ivPercent=200 on a mildly-wiggly series reliably reads as IV > HV -> no inversion.
    await runOnDate("2026-02-02T15:00:00Z", stateMap, 200);
    expect(stateMap.get("vrp-inversion-long:TST:streak")).toBe("0");
  });

  it("fires the trade in the same run that reaches a streak of 3, and resets it after", async () => {
    const stateMap = new Map<string, string>([
      ["vrp-inversion-long:TST:streak", "2"],
      ["vrp-inversion-long:TST:streak_date", "2026-02-01"],
    ]);
    const result = await runOnDate("2026-02-02T15:00:00Z", stateMap, 10); // inversion -> 2 becomes 3
    expect(result.fired).not.toBeNull();
    expect(stateMap.get("vrp-inversion-long:TST:streak")).toBe("0");
  });

  it("does NOT reset the streak to 0 just because the order failed to place (postOrderStateUpdates withheld)", async () => {
    // Same setup as the test above, but this time we deliberately don't apply
    // postOrderStateUpdates — simulating runner.ts's behavior when executeOrder throws.
    // The natural increment in `stateUpdates` (now "3") must be what persists, not "0" —
    // otherwise a failed order placement would permanently lose an already-earned streak.
    const stateMap = new Map<string, string>([
      ["vrp-inversion-long:TST:streak", "2"],
      ["vrp-inversion-long:TST:streak_date", "2026-02-01"],
    ]);
    setFakeDate("2026-02-02T15:00:00Z");
    const tstBars = barsEndingNow(wigglyCloses(100, 0.08));
    const ctx = {
      alpaca: mockStreakAlpaca(10, tstBars), equity: 100_000, perPositionBudget: 2_000,
      positions: [], tags: [], stateMap, microScanList: ["TST"], macroEquityList: null,
    } as SignalContext;
    const result = await signalVrpInversionLong(ctx);
    expect(result.fired).not.toBeNull();
    expect(result.fired!.postOrderStateUpdates).toEqual([{ key: "vrp-inversion-long:TST:streak", value: "0" }]);
    // Apply ONLY stateUpdates, as runner.ts does before attempting the order — not
    // postOrderStateUpdates, which runner.ts withholds until the order is confirmed.
    for (const u of result.fired!.stateUpdates) stateMap.set(u.key, u.value);
    expect(stateMap.get("vrp-inversion-long:TST:streak")).toBe("3");
  });

  it("restarts the streak when the previous count wasn't the immediately preceding trading session", async () => {
    // Last counted 2026-01-28, but the actual prior session (per the real trading calendar)
    // was 2026-01-30 — a 2-session gap (e.g. the symbol briefly dropped out of the scanner
    // list). The old code only checked lastCountedDate !== today and would have let this
    // count as day 3 of a "consecutive" streak; it's actually day 1 of a new one.
    const stateMap = new Map<string, string>([
      ["vrp-inversion-long:TST:streak", "2"],
      ["vrp-inversion-long:TST:streak_date", "2026-01-28"],
    ]);
    const calendarDates = ["2026-01-28", "2026-01-29", "2026-01-30", "2026-02-02"];
    const result = await runOnDate("2026-02-02T15:00:00Z", stateMap, 10, calendarDates);
    expect(result.fired?.orders ?? []).toHaveLength(0); // only day 1 of a restarted streak, not 3
    expect(stateMap.get("vrp-inversion-long:TST:streak")).toBe("1");
  });

  it("does NOT treat a weekend as a gap when the previous session genuinely is the prior Friday", async () => {
    // lastCountedDate IS the actual previous trading session (the calendar has no session
    // between Fri 2026-01-30 and Mon 2026-02-02) — this must still advance normally and fire.
    const stateMap = new Map<string, string>([
      ["vrp-inversion-long:TST:streak", "2"],
      ["vrp-inversion-long:TST:streak_date", "2026-01-30"],
    ]);
    const calendarDates = ["2026-01-29", "2026-01-30", "2026-02-02"];
    const result = await runOnDate("2026-02-02T15:00:00Z", stateMap, 10, calendarDates);
    expect(result.fired).not.toBeNull();
    expect(stateMap.get("vrp-inversion-long:TST:streak")).toBe("0"); // fired, then reset
  });
});
