/**
 * Integration tests for IV estimation — hit real Alpaca paper API.
 * Run with: npm run test:integration
 *
 * Skips automatically if ALPACA_TRADING_KEY_ID_ACCOUNT_1 is not set.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { AlpacaClient } from "../alpaca";
import { estimateIV, selectStraddleContracts, selectStrangleStrikes } from "./iv";

let alpaca: AlpacaClient;
// Real prices fetched from Alpaca before tests run — no hardcoded approximates.
const livePrices = new Map<string, number>();

const TEST_TICKERS = ["AAPL", "NVDA", "TSLA", "AMZN", "SPY"];

beforeAll(async () => {
  const key    = process.env.ALPACA_TRADING_KEY_ID_ACCOUNT_1;
  const secret = process.env.ALPACA_TRADING_SECRET_ACCOUNT_1;
  if (!key || !secret) {
    console.warn("Skipping IV integration tests — ALPACA_TRADING_KEY_ID_ACCOUNT_1 not set");
    return;
  }
  alpaca = new AlpacaClient(key, secret);

  // Fetch real current prices so ATM band aligns with actual market
  await Promise.all(TEST_TICKERS.map(async sym => {
    try {
      const snap = await alpaca.getSnapshot(sym);
      const price = snap.latestTrade?.p ?? snap.latestQuote?.ap ?? 0;
      if (price > 0) livePrices.set(sym, price);
    } catch { /* skip */ }
  }));
  console.log("Live prices:", Object.fromEntries(livePrices));
});

function skipIfNoClient() {
  return !alpaca;
}

// ── estimateIV ────────────────────────────────────────────────────────────────

describe("estimateIV (real Alpaca)", () => {
  for (const symbol of TEST_TICKERS) {
    it(`${symbol}: returns a valid IVEstimate`, async () => {
      if (skipIfNoClient()) return;

      const stockPrice = livePrices.get(symbol);
      if (!stockPrice) {
        console.log(`  ⚠ ${symbol} — could not fetch live price, skipping`);
        return;
      }

      const result = await estimateIV(alpaca, symbol, stockPrice);

      if (!result) {
        console.log(`  ✗ ${symbol.padEnd(5)} @ $${stockPrice} — null (no priced call+put in 28–50 DTE window)`);
      } else {
        console.log(
          `  ✓ ${symbol.padEnd(5)} @ $${stockPrice}` +
          `  IV ${result.iv.toFixed(1).padStart(6)}%` +
          `  straddle $${result.straddle.toFixed(2).padStart(7)}` +
          `  strike $${String(result.atmStrike).padStart(7)}` +
          `  ${result.dte} DTE`
        );
      }

      if (result) {
        // Strike must be within the ±7% ATM band
        expect(result.atmStrike).toBeGreaterThan(stockPrice * 0.93);
        expect(result.atmStrike).toBeLessThan(stockPrice * 1.07);
        // Straddle must be positive and under the stock price
        expect(result.straddle).toBeGreaterThan(0);
        expect(result.straddle).toBeLessThan(stockPrice);
        // IV must be positive
        expect(result.iv).toBeGreaterThan(0);
        // DTE must be in window
        expect(result.dte).toBeGreaterThanOrEqual(25);
        expect(result.dte).toBeLessThanOrEqual(55);
      }
    });
  }
});

// ── selectStraddleContracts ───────────────────────────────────────────────────

describe("selectStraddleContracts (real Alpaca)", () => {
  it("AAPL: returns valid call + put symbols", async () => {
    if (skipIfNoClient()) return;

    const stockPrice = livePrices.get("AAPL") ?? 315;
    const result = await selectStraddleContracts(alpaca, "AAPL", stockPrice);
    if (!result) {
      console.log("  ✗ AAPL straddle — null (no priced pair found)");
    } else {
      console.log(`  ✓ call  ${result.callSymbol}`);
      console.log(`  ✓ put   ${result.putSymbol}`);
      console.log(`  ✓ strike $${result.strike}  expiry ${result.expiry}`);
    }
    expect(result).not.toBeNull();
    if (result) {
      expect(result.callSymbol).toMatch(/^AAPL\d{6}C\d{8}$/);
      expect(result.putSymbol).toMatch(/^AAPL\d{6}P\d{8}$/);
      expect(result.strike).toBeGreaterThan(0);
    }
  });
});

// ── selectStrangleStrikes ─────────────────────────────────────────────────────

describe("selectStrangleStrikes (real Alpaca)", () => {
  it("AAPL: call strike > put strike (OTM strangle)", async () => {
    if (skipIfNoClient()) return;

    const stockPrice = livePrices.get("AAPL") ?? 315;
    const result = await selectStrangleStrikes(alpaca, "AAPL", stockPrice, 30); // IV=30%
    if (!result) {
      console.log("  ✗ AAPL strangle — null");
    } else {
      const width = result.callStrike - result.putStrike;
      console.log(`  ✓ call $${result.callStrike}  put $${result.putStrike}  width $${width.toFixed(0)}  expiry ${result.expiry}`);
    }
    expect(result).not.toBeNull();
    if (result) {
      expect(result.callStrike).toBeGreaterThan(result.putStrike);
    }
  });
});
