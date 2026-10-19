/**
 * Unit tests for the Brenner-Subrahmanyam IV approximation, cross-checked against an
 * independent Black-Scholes pricer so a future edit to the formula can't silently
 * reintroduce the 2x bug this file fixes (see the comment above estimateIV in iv.ts).
 *
 * No network calls — mocks AlpacaClient to return contracts priced at exact BS fair value.
 */
import { describe, it, expect } from "vitest";
import type { AlpacaClient, OptionContract } from "../alpaca";
import { estimateIV } from "./iv";

// ── Independent Black-Scholes reference pricer (not shared code with iv.ts) ───────

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}
function bsCallPut(S: number, K: number, T: number, sigma: number, r = 0): { call: number; put: number } {
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const call = S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  const put = K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
  return { call, put };
}

// ── Mock AlpacaClient serving one ATM call+put priced at exact BS fair value ───────

function mockAlpacaForStraddle(S: number, K: number, dte: number, truePrices: { call: number; put: number }): AlpacaClient {
  const expiry = new Date(Date.now() + dte * 86_400_000).toISOString().slice(0, 10);
  const mk = (type: "call" | "put", price: number): OptionContract => ({
    id: `${type}-1`, symbol: `TST${type === "call" ? "C" : "P"}`, underlying_symbol: "TST",
    type, expiration_date: expiry, strike_price: String(K),
    open_interest: "100", close_price: price.toFixed(4),
  });
  return {
    getOptionsContracts: async (_underlying: string, opts: { type?: "call" | "put" }) => ({
      option_contracts: opts.type === "call" ? [mk("call", truePrices.call)] : [mk("put", truePrices.put)],
      next_page_token: null,
    }),
    getOptionsSnapshots: async () => ({ snapshots: {} }),
  } as unknown as AlpacaClient;
}

describe("estimateIV (Brenner-Subrahmanyam straddle formula)", () => {
  it("reads back the true volatility within 1 point for a 30%-vol ATM straddle at 38 DTE", async () => {
    const S = 100, K = 100, dte = 38, trueSigma = 0.30;
    const T = dte / 365;
    const prices = bsCallPut(S, K, T, trueSigma);
    const alpaca = mockAlpacaForStraddle(S, K, dte, prices);

    const est = await estimateIV(alpaca, "TST", S);
    expect(est).not.toBeNull();
    expect(est!.iv).toBeGreaterThan(trueSigma * 100 - 1);
    expect(est!.iv).toBeLessThan(trueSigma * 100 + 1);
  });

  it("stays accurate across a range of vols and expiries (not a one-point coincidence)", async () => {
    for (const [sigma, dte] of [[0.15, 30], [0.45, 45], [0.60, 28], [0.25, 50]] as const) {
      const S = 100, K = 100;
      const prices = bsCallPut(S, K, dte / 365, sigma);
      const alpaca = mockAlpacaForStraddle(S, K, dte, prices);
      const est = await estimateIV(alpaca, "TST", S);
      expect(est).not.toBeNull();
      // B-S approximation has some inherent error away from 30 DTE/ATM; allow 5% relative.
      expect(est!.iv).toBeGreaterThan(sigma * 100 * 0.95);
      expect(est!.iv).toBeLessThan(sigma * 100 * 1.05);
    }
  });

  it("does NOT reproduce the old ~2x-too-high bug", async () => {
    const S = 100, K = 100, dte = 38, trueSigma = 0.30;
    const prices = bsCallPut(S, K, dte / 365, trueSigma);
    const alpaca = mockAlpacaForStraddle(S, K, dte, prices);
    const est = await estimateIV(alpaca, "TST", S);
    const ratio = est!.iv / (trueSigma * 100);
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1); // old formula would read ~2.0 here
  });
});
