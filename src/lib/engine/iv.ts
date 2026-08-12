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

async function fetchContracts(
  alpaca: AlpacaClient,
  underlying: string,
  minDte: number,
  maxDte: number,
): Promise<OptionContract[]> {
  const today = new Date();
  const min = new Date(today.getTime() + minDte * 86400_000);
  const max = new Date(today.getTime() + maxDte * 86400_000);
  try {
    const res = await alpaca.getOptionsContracts(underlying, {
      expiration_date_gte: toDateStr(min),
      expiration_date_lte: toDateStr(max),
      limit: 100,
    });
    return res.option_contracts ?? [];
  } catch {
    return [];
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

function atmStrike(contracts: OptionContract[], stockPrice: number): number {
  const strikes = [...new Set(contracts.map(c => parseFloat(c.strike_price)))];
  return strikes.reduce((best, s) =>
    Math.abs(s - stockPrice) < Math.abs(best - stockPrice) ? s : best,
    strikes[0],
  );
}

/**
 * Estimates IV using the Brenner-Subrahmanyam ATM approximation:
 *   IV ≈ sqrt(2π / T) × (C + P) / S
 * where T is time to expiry in years, C and P are the ATM call and put prices.
 *
 * Uses the expiry closest to 38 DTE (Goyal & Saretto's optimal 30-45 DTE window).
 * Returns null if Alpaca has no priced option contracts for this underlying.
 */
export async function estimateIV(
  alpaca: AlpacaClient,
  underlying: string,
  stockPrice: number,
): Promise<IVEstimate | null> {
  const contracts = await fetchContracts(alpaca, underlying, 28, 50);
  if (contracts.length === 0) return null;

  const expiry = nearestExpiry(contracts, 38);
  if (!expiry) return null;

  const expContracts = contracts.filter(c => c.expiration_date === expiry);
  const strike = atmStrike(expContracts, stockPrice);
  const atm = expContracts.filter(c => parseFloat(c.strike_price) === strike);

  const call = atm.find(c => c.type === "call");
  const put  = atm.find(c => c.type === "put");
  if (!call?.close_price || !put?.close_price) return null;

  const C = parseFloat(call.close_price);
  const P = parseFloat(put.close_price);
  const straddle = C + P;
  const dte = daysUntil(expiry);
  const T = dte / 365;

  // Brenner-Subrahmanyam: IV = sqrt(2π/T) × straddle / S
  const iv = Math.sqrt((2 * Math.PI) / T) * (straddle / stockPrice) * 100;

  return { iv, straddle, dte, atmStrike: strike };
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
  const contracts = await fetchContracts(alpaca, underlying, 28, 50);
  if (contracts.length === 0) return null;

  const expiry = nearestExpiry(contracts, targetDte);
  if (!expiry) return null;

  const dte = daysUntil(expiry);
  const sigma = (ivPct / 100) * Math.sqrt(dte / 365);

  const targetCallStrike = stockPrice * Math.exp(+0.67 * sigma);
  const targetPutStrike  = stockPrice * Math.exp(-0.67 * sigma);

  const callContracts = contracts.filter(c => c.expiration_date === expiry && c.type === "call");
  const putContracts  = contracts.filter(c => c.expiration_date === expiry && c.type === "put");

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

/**
 * Finds the ATM call and put contract symbols for a straddle (buy vol).
 */
export async function selectStraddleContracts(
  alpaca: AlpacaClient,
  underlying: string,
  stockPrice: number,
): Promise<{ callSymbol: string; putSymbol: string; strike: number; expiry: string } | null> {
  const contracts = await fetchContracts(alpaca, underlying, 28, 50);
  if (contracts.length === 0) return null;

  const expiry = nearestExpiry(contracts, 38);
  if (!expiry) return null;

  const expContracts = contracts.filter(c => c.expiration_date === expiry);
  const strike = atmStrike(expContracts, stockPrice);
  const atm = expContracts.filter(c => parseFloat(c.strike_price) === strike);

  const call = atm.find(c => c.type === "call");
  const put  = atm.find(c => c.type === "put");
  if (!call || !put) return null;

  return { callSymbol: call.symbol, putSymbol: put.symbol, strike, expiry };
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
  const contracts = await fetchContracts(alpaca, underlying, minDaysOut, minDaysOut + 10);
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
  const strike = atmStrike(expContracts, stockPrice);
  const atm = expContracts.filter(c => parseFloat(c.strike_price) === strike);

  const call = atm.find(c => c.type === "call");
  const put  = atm.find(c => c.type === "put");
  if (!call || !put) return null;

  return { callSymbol: call.symbol, putSymbol: put.symbol, strike, expiry };
}
