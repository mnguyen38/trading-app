/**
 * Integration tests for signal functions — hit real Alpaca paper API.
 * Run with: npm run test:integration
 *
 * These don't place orders. They verify that every signal function:
 *   1. Returns the right shape: { fired, log }
 *   2. Produces meaningful diagnostic log lines
 *   3. Doesn't throw
 */
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "../../db/client";
import { strategyTrades } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getAllTraders } from "../traders";
import { alpacaForTrader } from "../alpaca";
import type { SignalContext } from "./signals";
import {
  signalVolSpreadLong,
  signalVrpPremiumSeller,
  signalEarningsIVCrush,
  signalVrpInversionLong,
  signalSectorRotation,
  signalQualityHold,
  signalEconomicCycle,
  signalSwingTrade,
} from "./signals";

let ctx: SignalContext;
let microCtx: SignalContext;
let macroCtx: SignalContext;

beforeAll(async () => {
  if (!process.env.ALPACA_TRADING_KEY_ID_ACCOUNT_1) {
    console.warn("Skipping signal integration tests — env not set");
    return;
  }

  const traders = await getAllTraders();
  const micro = traders.find(t => t.type === "micro");
  const macro = traders.find(t => t.type === "macro");

  if (!micro || !macro) {
    console.warn("Skipping — micro or macro trader not found in DB");
    return;
  }

  const microAlpaca = alpacaForTrader(micro);
  const macroAlpaca = alpacaForTrader(macro);

  const [microAccount, microPositions, microTags] = await Promise.all([
    microAlpaca.getAccount(),
    microAlpaca.getPositions(),
    db.select({ strategySlug: strategyTrades.strategySlug, symbol: strategyTrades.symbol })
      .from(strategyTrades).where(eq(strategyTrades.traderId, micro.id)),
  ]);

  const [macroAccount, macroPositions, macroTags] = await Promise.all([
    macroAlpaca.getAccount(),
    macroAlpaca.getPositions(),
    db.select({ strategySlug: strategyTrades.strategySlug, symbol: strategyTrades.symbol })
      .from(strategyTrades).where(eq(strategyTrades.traderId, macro.id)),
  ]);

  microCtx = {
    alpaca: microAlpaca,
    equity: parseFloat(microAccount.equity),
    perPositionBudget: parseFloat(microAccount.equity) * 0.10,
    positions: microPositions,
    tags: microTags,
    stateMap: new Map(),
    microScanList: null,   // use fallback universe — same as when scanner hasn't run
    macroEquityList: null,
  };

  macroCtx = {
    alpaca: macroAlpaca,
    equity: parseFloat(macroAccount.equity),
    perPositionBudget: parseFloat(macroAccount.equity) * 0.10,
    positions: macroPositions,
    tags: macroTags,
    stateMap: new Map(),
    microScanList: null,
    macroEquityList: null,
  };

  ctx = microCtx; // default for shared tests
});

function skip() { return !ctx; }

// ── Shape checks ──────────────────────────────────────────────────────────────
// Every signal must return { fired, log } — never throw.

const microSignals = [
  ["vol-spread-long",    () => signalVolSpreadLong(microCtx)],
  ["vrp-premium-seller", () => signalVrpPremiumSeller(microCtx)],
  ["earnings-iv-crush",  () => signalEarningsIVCrush(microCtx)],
  ["vrp-inversion-long", () => signalVrpInversionLong(microCtx)],
] as const;

const macroSignals = [
  ["sector-rotation",  () => signalSectorRotation(macroCtx)],
  ["quality-hold",     () => signalQualityHold(macroCtx)],
  ["economic-cycle",   () => signalEconomicCycle(macroCtx)],
  ["swing-trade",      () => signalSwingTrade(macroCtx)],
] as const;

describe("micro signal shapes (real Alpaca)", () => {
  for (const [name, fn] of microSignals) {
    it(`${name}: returns { fired, log } without throwing`, async () => {
      if (skip()) return;

      const result = await fn();

      // ── Logging ──
      const fired = result.fired;
      const ivLines    = result.log.filter(l => l.includes("IV") && l.includes("HV30"));
      const signalLine = result.log.find(l => l.includes("✓ SIGNAL"));
      const skipLine   = result.log.find(l => l.includes("cooldown") || l.includes("max positions"));

      console.log(`\n  ┌─ ${name} ${"─".repeat(Math.max(0, 42 - name.length))}`);
      console.log(`  │  fired: ${fired ? `YES — ${fired.underlying}` : "no"}`);
      if (skipLine) console.log(`  │  ${skipLine}`);
      if (signalLine) console.log(`  │  ${signalLine}`);
      if (fired?.orders.length) {
        for (const o of fired.orders) {
          console.log(`  │  order: ${o.side.toUpperCase()} ${o.qty}× ${o.symbol}`);
        }
      }
      console.log(`  │  tickers scanned: ${ivLines.length} got IV estimates`);
      // Show first 3 IV lines so you can see actual numbers
      for (const l of ivLines.slice(0, 3)) console.log(`  │    ${l}`);
      if (ivLines.length > 3) console.log(`  │    ... +${ivLines.length - 3} more`);
      console.log(`  └${"─".repeat(50)}`);

      // ── Assertions ──
      expect(result).toHaveProperty("fired");
      expect(result).toHaveProperty("log");
      expect(Array.isArray(result.log)).toBe(true);
      expect(result.log.length).toBeGreaterThan(0);
      for (const line of result.log) {
        expect(typeof line).toBe("string");
        expect(line.length).toBeGreaterThan(0);
      }
      if (fired) {
        expect(fired.strategySlug).toBe(name);
        expect(typeof fired.underlying).toBe("string");
        expect(Array.isArray(fired.orders)).toBe(true);
      }
    });
  }
});

describe("macro signal shapes (real Alpaca)", () => {
  for (const [name, fn] of macroSignals) {
    it(`${name}: returns { fired, log } without throwing`, async () => {
      if (skip()) return;

      const result = await fn();

      // ── Logging ──
      const fired = result.fired;

      console.log(`\n  ┌─ ${name} ${"─".repeat(Math.max(0, 42 - name.length))}`);
      console.log(`  │  fired: ${fired ? `YES — ${fired.underlying}` : "no"}`);
      // Print all log lines for macro (they're shorter and all meaningful)
      for (const l of result.log) console.log(`  │  ${l}`);
      if (fired?.orders.length) {
        console.log(`  │  orders:`);
        for (const o of fired.orders) {
          console.log(`  │    ${o.side.toUpperCase()} ${o.qty}× ${o.symbol}`);
        }
      }
      console.log(`  └${"─".repeat(50)}`);

      // ── Assertions ──
      expect(result).toHaveProperty("fired");
      expect(result).toHaveProperty("log");
      expect(Array.isArray(result.log)).toBe(true);
      expect(result.log.length).toBeGreaterThan(0);
      if (fired) {
        expect(fired.strategySlug).toBe(name);
        expect(Array.isArray(fired.orders)).toBe(true);
      }
    });
  }
});

// ── IV-specific checks ────────────────────────────────────────────────────────

describe("vol-spread-long IV log lines (real Alpaca)", () => {
  it("produces per-ticker IV diagnostic lines — not all 'no ATM contracts'", async () => {
    if (skip()) return;

    const result = await signalVolSpreadLong(microCtx);

    const noContractLines  = result.log.filter(l => l.includes("no ATM contracts") || l.includes("could not estimate IV"));
    const hasIvLines       = result.log.filter(l => l.includes("IV") && l.includes("HV30") && l.includes("%"));
    const insufficientBars = result.log.filter(l => l.includes("need 31+"));

    console.log(`\n  Log lines: ${result.log.length} total`);
    console.log(`  With IV estimate: ${hasIvLines.length}`);
    console.log(`  Could not estimate IV: ${noContractLines.length}`);
    console.log(`  Insufficient bars: ${insufficientBars.length}`);

    // After the nearestPricedPair fix, at least some liquid tickers should get IV estimates
    expect(hasIvLines.length, "No tickers got IV estimates — nearestPricedPair fix may not be working").toBeGreaterThan(0);
  });
});
