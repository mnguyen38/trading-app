import type { AlpacaClient, OptionContract } from "../alpaca";

export type IVEstimate = {
  iv: number;         // annualised IV as a percentage (e.g. 28.5 for 28.5%)
  straddle: number;   // ATM call + put cost in dollars
  dte: number;        // days to expiry of the contracts used
  atmStrike: number;  // the ATM strike price selected
};

export type StrikeSelection = {
  callSymbol: string;
  putSymbol: string;
  callStrike: number;
  putStrike: number;
  expiry: string;
};

const toDateStr = (d: Date) => d.toISOString().split("T")[0];

// Fetches calls AND puts in separate requests to avoid the limit exhausting on one type.
// When stockPrice is provided, adds a ±20% strike filter so the 100-contract limit isn't
// wasted on far-OTM contracts from lower expiries before reaching the ATM range of later ones.
async function fetchContracts(
  alpaca: AlpacaClient,
  underlying: string,
  minDte: number,
  maxDte: number,
  stockPrice?: number,
): Promise<{ contracts: OptionContract[]; error?: string }> {
  const today = new Date();
  const min = new Date(today.getTime() + minDte * 86400_000);
  const max = new Date(today.getTime() + maxDte * 86400_000);
  const shared = {
    expiration_date_gte: toDateStr(min),
    expiration_date_lte: toDateStr(max),
    limit: 100,
    ...(stockPrice ? {
      strike_price_gte: String(Math.floor(stockPrice * 0.80)),
      strike_price_lte: String(Math.ceil(stockPrice * 1.20)),
    } : {}),
  };
  try {
    const [callRes, putRes] = await Promise.all([
      alpaca.getOptionsContracts(underlying, { ...shared, type: "call" }),
      alpaca.getOptionsContracts(underlying, { ...shared, type: "put" }),
    ]);
    const contracts = [
      ...(callRes.option_contracts ?? []),
      ...(putRes.option_contracts ?? []),
    ];
    if (contracts.length === 0) {
      return { contracts: [], error: `no contracts returned for ${minDte}–${maxDte} DTE window` };
    }
    return { contracts };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { contracts: [], error: msg };
  }
}

function daysUntil(dateStr: string): number {
  return Math.max(1, Math.round(
    (new Date(dateStr).getTime() - Date.now()) / 86400_000,
  ));
}

function nearestExpiry(contracts: OptionContract[], targetDte: number): string | null {
  const expiries = [...new Set(contracts.map(c => c.expiration_date))].sort();
  if (expiries.length === 0) return null;
  const targetMs = Date.now() + targetDte * 86400_000;
  return expiries.reduce((best, e) =>
    Math.abs(new Date(e).getTime() - targetMs) <
    Math.abs(new Date(best).getTime() - targetMs) ? e : best,
    expiries[0],
  );
}

// Only consider strikes within ±7% for the B-S approximation.
// Wider bands let deep-ITM/OTM close prices produce nonsense IV (e.g. 760% for NVDA $115 at $130).
const ATM_BAND_PCT = 0.07;

// Fetches live bid/ask snapshots for near-ATM contracts that lack close_price.
// Returns a symbol→midPrice map for use in nearestPricedPair.
async function fetchLivePrices(
  alpaca: AlpacaClient,
  contracts: OptionContract[],
  stockPrice: number,
): Promise<Map<string, number>> {
  const band = stockPrice * ATM_BAND_PCT;
  const needsQuote = contracts
    .filter(c => !c.close_price && Math.abs(parseFloat(c.strike_price) - stockPrice) <= band)
    .slice(0, 60); // cap snapshot batch size
  if (needsQuote.length === 0) return new Map();
  try {
    const symbols = needsQuote.map(c => c.symbol);
    const snap = await alpaca.getOptionsSnapshots(symbols);
    const map = new Map<string, number>();
    for (const [sym, data] of Object.entries(snap.snapshots)) {
      const q = data.latestQuote;
      if (q && q.ap > 0 && q.bp > 0) {
        map.set(sym, (q.ap + q.bp) / 2); // mid-price
      } else if (data.latestTrade?.p) {
        map.set(sym, data.latestTrade.p);
      }
    }
    return map;
  } catch (e) {
    console.warn(`[iv] snapshot fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    return new Map();
  }
}

// Finds the nearest near-ATM strike that has a price on BOTH call and put.
// Checks close_price first (yesterday's close), then falls back to live snapshot mid-price.
// Only considers strikes within ATM_BAND_PCT of stockPrice to keep the B-S approximation valid.
function nearestPricedPair(
  contracts: OptionContract[],
  stockPrice: number,
  livePrices: Map<string, number> = new Map(),
): { call: OptionContract; put: OptionContract; strike: number; callPrice: number; putPrice: number } | null {
  const getPrice = (c: OptionContract): number | null => {
    if (c.close_price) return parseFloat(c.close_price);
    return livePrices.get(c.symbol) ?? null;
  };

  const atmBand = stockPrice * ATM_BAND_PCT;
  const strikes = [...new Set(contracts.map(c => parseFloat(c.strike_price)))]
    .filter(s => Math.abs(s - stockPrice) <= atmBand)        // near-ATM only (±7%)
    .sort((a, b) => Math.abs(a - stockPrice) - Math.abs(b - stockPrice));

  for (const s of strikes) {
    const call = contracts.find(c => parseFloat(c.strike_price) === s && c.type === "call" && getPrice(c) !== null);
    const put  = contracts.find(c => parseFloat(c.strike_price) === s && c.type === "put"  && getPrice(c) !== null);
    if (call && put) return { call, put, strike: s, callPrice: getPrice(call)!, putPrice: getPrice(put)! };
  }
  return null;
}

/**
 * Estimates IV using the Brenner-Subrahmanyam ATM approximation.
 *
 * The original B-S approximation is for a SINGLE ATM call: C ≈ 0.4·S·σ·√T, i.e.
 *   σ ≈ sqrt(2π/T) × C/S.
 * By put-call parity an ATM straddle ≈ 2C (r≈0), so substituting C = straddle/2:
 *   σ ≈ sqrt(2π/T) × (straddle/2)/S = sqrt(π/(2T)) × straddle/S.
 * The code previously used sqrt(2π/T) directly against the straddle price, which is
 * the single-call formula applied to a straddle — off by a factor of 2 (one call's
 * worth of coefficient, straddle-sized input). Verified against a Black-Scholes
 * straddle priced at a known vol: the old formula read back ~2.00x the true sigma,
 * this one reads back 1.00x (see iv.test.ts).
 *
 * Uses the expiry closest to 38 DTE (Goyal & Saretto's optimal 30-45 DTE window).
 * Returns null if Alpaca has no priced option contracts for this underlying.
 */
export async function estimateIV(
  alpaca: AlpacaClient,
  underlying: string,
  stockPrice: number,
): Promise<IVEstimate & { fetchError?: string } | null> {
  const { contracts, error } = await fetchContracts(alpaca, underlying, 28, 50, stockPrice);
  if (contracts.length === 0) {
    console.warn(`[iv] ${underlying}: ${error}`);
    return null;
  }

  const expiry = nearestExpiry(contracts, 38);
  if (!expiry) return null;

  const expContracts = contracts.filter(c => c.expiration_date === expiry);
  const livePrices = await fetchLivePrices(alpaca, expContracts, stockPrice);
  const pair = nearestPricedPair(expContracts, stockPrice, livePrices);
  if (!pair) {
    const liveFetched = livePrices.size;
    console.warn(`[iv] ${underlying}: contracts found for ${expiry} but no strike has priced call+put (${liveFetched} live quotes fetched)`);
    return null;
  }

  const straddle = pair.callPrice + pair.putPrice;
  const dte = daysUntil(expiry);
  const T = dte / 365;

  // Brenner-Subrahmanyam (straddle form): IV = sqrt(π/(2T)) × straddle / S
  const iv = Math.sqrt(Math.PI / (2 * T)) * (straddle / stockPrice) * 100;

  return { iv, straddle, dte, atmStrike: pair.strike };
}

/**
 * Finds OTM call and put contract symbols for a short strangle at approximately
 * 25-delta. Uses the 0.67σ approximation:
 *   call_strike ≈ S × exp(+0.67 × IV/100 × sqrt(T))
 *   put_strike  ≈ S × exp(-0.67 × IV/100 × sqrt(T))
 *
 * Returns the nearest available strikes from Alpaca's contract list.
 */
export async function selectStrangleStrikes(
  alpaca: AlpacaClient,
  underlying: string,
  stockPrice: number,
  ivPct: number,
  targetDte = 38,
): Promise<StrikeSelection | null> {
  const { contracts } = await fetchContracts(alpaca, underlying, 28, 50, stockPrice);
  if (contracts.length === 0) return null;

  const expiry = nearestExpiry(contracts, targetDte);
  if (!expiry) return null;

  const dte = daysUntil(expiry);
  const sigma = (ivPct / 100) * Math.sqrt(dte / 365);

  const targetCallStrike = stockPrice * Math.exp(+0.67 * sigma);
  const targetPutStrike  = stockPrice * Math.exp(-0.67 * sigma);

  // Only consider OTM-ish contracts: calls above 85% of stock price, puts below 115%.
  // Deep-ITM contracts would give nonsense strikes for a strangle.
  const callContracts = contracts.filter(c =>
    c.expiration_date === expiry && c.type === "call" && parseFloat(c.strike_price) >= stockPrice * 0.85
  );
  const putContracts = contracts.filter(c =>
    c.expiration_date === expiry && c.type === "put" && parseFloat(c.strike_price) <= stockPrice * 1.15
  );

  if (callContracts.length === 0 || putContracts.length === 0) return null;

  const nearestCall = callContracts.reduce((best, c) => {
    const s = parseFloat(c.strike_price);
    return Math.abs(s - targetCallStrike) < Math.abs(parseFloat(best.strike_price) - targetCallStrike)
      ? c : best;
  }, callContracts[0]);

  const nearestPut = putContracts.reduce((best, c) => {
    const s = parseFloat(c.strike_price);
    return Math.abs(s - targetPutStrike) < Math.abs(parseFloat(best.strike_price) - targetPutStrike)
      ? c : best;
  }, putContracts[0]);

  return {
    callSymbol: nearestCall.symbol,
    putSymbol:  nearestPut.symbol,
    callStrike: parseFloat(nearestCall.strike_price),
    putStrike:  parseFloat(nearestPut.strike_price),
    expiry,
  };
}

export type ShortPremiumStructure = {
  expiry: string;
  // Cash-secured put: sell this strike directly. Collateral = strike × 100 in cash —
  // never requires owning the underlying stock (Alpaca options level 1).
  shortPutSymbol: string;
  shortPutStrike: number;
  // Credit call spread: sell shortCallSymbol, buy longCallSymbol (the further-OTM "wing").
  // The wing caps the combo's max loss at the strike width, which is what lets the short
  // call be sold WITHOUT owning the stock (a bare short call would need level 1's covered-
  // call construction — buy 100 shares per contract — or an uncovered-short approval
  // Alpaca doesn't offer at all; the wing is what makes this level 3's "covered" instead).
  shortCallSymbol: string;
  shortCallStrike: number;
  longCallSymbol: string;
  longCallStrike: number;
};

/**
 * Builds the two covered short-premium structures for the VRP-short sleeve: a cash-secured
 * put, and a credit call spread. Reuses selectStrangleStrikes' ~25-delta short strikes, then
 * finds the nearest listed strike ABOVE the short call as the spread's protective wing.
 * Returns null if either side can't be built (no strangle strikes, or no listed strike
 * further OTM than the short call for the wing).
 */
export async function selectShortPremiumStructure(
  alpaca: AlpacaClient,
  underlying: string,
  stockPrice: number,
  ivPct: number,
  targetDte = 38,
): Promise<ShortPremiumStructure | null> {
  const strangle = await selectStrangleStrikes(alpaca, underlying, stockPrice, ivPct, targetDte);
  if (!strangle) return null;

  const { contracts } = await fetchContracts(alpaca, underlying, 28, 50, stockPrice);
  const wingCandidates = contracts.filter(c =>
    c.expiration_date === strangle.expiry && c.type === "call" && parseFloat(c.strike_price) > strangle.callStrike,
  );
  if (wingCandidates.length === 0) return null;

  const wing = wingCandidates.reduce((best, c) =>
    parseFloat(c.strike_price) < parseFloat(best.strike_price) ? c : best,
  );

  return {
    expiry: strangle.expiry,
    shortPutSymbol: strangle.putSymbol,
    shortPutStrike: strangle.putStrike,
    shortCallSymbol: strangle.callSymbol,
    shortCallStrike: strangle.callStrike,
    longCallSymbol: wing.symbol,
    longCallStrike: parseFloat(wing.strike_price),
  };
}

/**
 * Finds the ATM call and put contract symbols for a straddle (buy vol).
 */
export async function selectStraddleContracts(
  alpaca: AlpacaClient,
  underlying: string,
  stockPrice: number,
): Promise<{ callSymbol: string; putSymbol: string; strike: number; expiry: string } | null> {
  const { contracts } = await fetchContracts(alpaca, underlying, 28, 50, stockPrice);
  if (contracts.length === 0) return null;

  const expiry = nearestExpiry(contracts, 38);
  if (!expiry) return null;

  const expContracts = contracts.filter(c => c.expiration_date === expiry);
  const livePrices = await fetchLivePrices(alpaca, expContracts, stockPrice);
  const pair = nearestPricedPair(expContracts, stockPrice, livePrices);
  if (!pair) return null;

  return { callSymbol: pair.call.symbol, putSymbol: pair.put.symbol, strike: pair.strike, expiry };
}

/**
 * Selects the first weekly expiry at least `minDaysOut` days from today.
 * Used for earnings IV crush (want expiry right after the announcement).
 */
export async function selectPostEarningsExpiry(
  alpaca: AlpacaClient,
  underlying: string,
  minDaysOut: number,
): Promise<{ callSymbol: string; putSymbol: string; strike: number; expiry: string } | null> {
  const { contracts } = await fetchContracts(alpaca, underlying, minDaysOut, minDaysOut + 10);
  if (contracts.length === 0) return null;

  const expiry = nearestExpiry(contracts, minDaysOut + 2);
  if (!expiry) return null;

  // Need stock price — fetch snapshot
  let stockPrice: number;
  try {
    const snap = await alpaca.getSnapshot(underlying);
    stockPrice = snap.latestTrade?.p ?? snap.latestQuote?.ap ?? 0;
  } catch {
    return null;
  }
  if (!stockPrice) return null;

  const expContracts = contracts.filter(c => c.expiration_date === expiry);
  const livePrices = await fetchLivePrices(alpaca, expContracts, stockPrice);
  const pair = nearestPricedPair(expContracts, stockPrice, livePrices);
  if (!pair) return null;

  return { callSymbol: pair.call.symbol, putSymbol: pair.put.symbol, strike: pair.strike, expiry };
}
