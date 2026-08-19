/**
 * Calculate implied volatility for a specific option contract.
 * Uses Black-Scholes call pricing + bisection to invert for IV.
 * Gets current time from Alpaca's clock endpoint — not the local system clock.
 *
 * Usage: node --env-file=.env scripts/calc-iv.mjs <OCC_SYMBOL> [optionMid] [underlyingPrice]
 * Example: node --env-file=.env scripts/calc-iv.mjs QQQ260820C00717000 2.72 716.95
 */

const key    = process.env.ALPACA_TRADING_KEY_ID_ACCOUNT_1;
const secret = process.env.ALPACA_TRADING_SECRET_ACCOUNT_1;
const BASE      = "https://paper-api.alpaca.markets/v2";
const DATA_V2   = "https://data.alpaca.markets/v2";
const DATA_OPT  = "https://data.alpaca.markets/v1beta1";
const headers   = { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret };

// ── Black-Scholes ─────────────────────────────────────────────────────────────

function normCdf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t)
              * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

function bsCall(S, K, T, r, sigma) {
  if (T <= 0) return Math.max(S - K, 0);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
}

function bsPut(S, K, T, r, sigma) {
  if (T <= 0) return Math.max(K - S, 0);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

// Bisection — robust even for very short DTE where Newton-Raphson diverges
function impliedVol(marketPrice, S, K, T, r, type = "call") {
  const bsFn = type === "call" ? bsCall : bsPut;
  const intrinsic = type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  if (marketPrice <= intrinsic) return null;

  let lo = 0.0001, hi = 30.0;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const price = bsFn(S, K, T, r, mid);
    if (Math.abs(price - marketPrice) < 0.0001) return mid;
    if (price > marketPrice) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

// ── Parse OCC symbol ──────────────────────────────────────────────────────────

function parseOcc(symbol) {
  const m = symbol.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) throw new Error(`Cannot parse OCC symbol: ${symbol}`);
  const [, underlying, yy, mm, dd, typeChar, strikeStr] = m;
  const expiry = `20${yy}-${mm}-${dd}`;
  const strike = parseInt(strikeStr, 10) / 1000;
  const type = typeChar === "C" ? "call" : "put";
  return { underlying, expiry, strike, type };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const symbol        = process.argv[2];
const optionMidArg  = parseFloat(process.argv[3] || "0");   // override option mid price
const underlyingArg = parseFloat(process.argv[4] || "0");   // override underlying price
if (!symbol) {
  console.error("Usage: node calc-iv.mjs <OCC_SYMBOL> [optionMid] [underlyingPrice]");
  process.exit(1);
}

const { underlying, expiry, strike, type } = parseOcc(symbol);
console.log(`Symbol:     ${symbol}`);
console.log(`Underlying: ${underlying}   Strike: $${strike}   Expiry: ${expiry}   Type: ${type}\n`);

// 1. Get authoritative current time from Alpaca's clock — not the local system clock
const clockRes = await fetch(`${BASE}/clock`, { headers });
const clock = await clockRes.json();
const now = new Date(clock.timestamp);
console.log(`Alpaca clock: ${clock.timestamp}  (market ${clock.is_open ? "OPEN" : "CLOSED"})`);

// 2. Current underlying price (from Alpaca or overridden)
const snapRes = await fetch(`${DATA_V2}/stocks/${underlying}/snapshot?feed=iex`, { headers });
const snapData = await snapRes.json();
const alpacaUnderlying = snapData.latestTrade?.p ?? snapData.latestQuote?.ap ?? 0;
const S = underlyingArg > 0 ? underlyingArg : alpacaUnderlying;
const underlyingSource = underlyingArg > 0 ? "override" : `Alpaca (${snapData.latestTrade ? "last trade" : "ask"})`;
console.log(`${underlying} price: $${S}  [${underlyingSource}]`);
console.log(`Moneyness: ${((strike / S - 1) * 100).toFixed(2)}%  (${S >= strike ? "ITM" : "OTM"} for call)\n`);

// 3. Option snapshot from Alpaca
const optSnap = await fetch(`${DATA_OPT}/options/snapshots?symbols=${symbol}&feed=indicative`, { headers });
const optData = await optSnap.json();
const snap = optData.snapshots?.[symbol];

const bid       = snap?.latestQuote?.bp ?? 0;
const ask       = snap?.latestQuote?.ap ?? 0;
const last      = snap?.latestTrade?.p  ?? 0;
const alpacaMid = bid > 0 && ask > 0 ? (bid + ask) / 2 : last;
const quoteTs   = snap?.latestQuote?.t ?? snap?.latestTrade?.t ?? "no data";

console.log(`Alpaca option quote (${quoteTs}):`);
console.log(`  Bid $${bid}  /  Ask $${ask}  /  Last $${last}  /  Mid $${alpacaMid.toFixed(3)}`);
if (quoteTs !== "no data") {
  const quoteAge = Math.round((now.getTime() - new Date(quoteTs).getTime()) / 60000);
  console.log(`  Quote age: ${quoteAge} minutes old`);
}

// Use override price if provided, otherwise use Alpaca mid
const C = optionMidArg > 0 ? optionMidArg : alpacaMid;
console.log(optionMidArg > 0
  ? `\nUsing your price: $${C}  (Alpaca mid was $${alpacaMid.toFixed(3)})`
  : `\nUsing Alpaca mid: $${C}`);

if (C <= 0) { console.log("No option price available — cannot compute IV."); process.exit(0); }

// 4. Time to expiry using Alpaca clock
const expiryClose = new Date(`${expiry}T20:00:00Z`); // 4 PM ET = 20:00 UTC
const T = Math.max(0, (expiryClose.getTime() - now.getTime()) / (1000 * 365.25 * 24 * 3600));
const minutesToExpiry = (expiryClose.getTime() - now.getTime()) / 60000;
console.log(`\nTime to expiry: ${minutesToExpiry.toFixed(0)} minutes (~${(minutesToExpiry/60).toFixed(1)}h)  T = ${T.toFixed(6)} years`);

// 5. Calculate IV
const r = 0.043; // ~4.3% risk-free rate
const iv = impliedVol(C, S, strike, T, r, type);

console.log(`\n── Result ───────────────────────────────────`);
if (iv === null) {
  console.log(`IV: cannot solve — price $${C} is below intrinsic value $${Math.max(S - strike, 0).toFixed(2)}`);
} else {
  console.log(`IV = ${(iv * 100).toFixed(2)}%  (Black-Scholes, r=${(r*100).toFixed(1)}%)`);
  // Cross-check: what price does this IV produce?
  const bsPrice = bsCall(S, strike, T, r, iv);
  console.log(`BS price check: $${bsPrice.toFixed(4)}  (target was $${C})`);
}

// 6. BS price table for context
console.log(`\nBS call prices at round IVs (S=$${S}, K=$${strike}, T=${minutesToExpiry.toFixed(0)}min):`);
for (const ivPct of [10, 15, 18, 20, 25, 30, 40, 50]) {
  const p = bsCall(S, strike, T, r, ivPct / 100);
  const marker = iv && Math.abs(iv * 100 - ivPct) < 1.5 ? " ◄" : "";
  console.log(`  IV=${String(ivPct).padStart(3)}%  →  $${p.toFixed(4)}${marker}`);
}
