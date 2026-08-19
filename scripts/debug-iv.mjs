// Debug: what contracts does Alpaca actually return for AAPL, and what are their prices?

const key    = process.env.ALPACA_TRADING_KEY_ID_ACCOUNT_1;
const secret = process.env.ALPACA_TRADING_SECRET_ACCOUNT_1;
const BASE   = "https://paper-api.alpaca.markets/v2";
const DATA   = "https://data.alpaca.markets/v1beta1";

const headers = {
  "APCA-API-KEY-ID": key,
  "APCA-API-SECRET-KEY": secret,
  "Content-Type": "application/json",
};

// 1. Get real current AAPL price (stocks use v2, not v1beta1)
const snap = await fetch(`${DATA.replace("v1beta1","v2")}/stocks/snapshots?symbols=AAPL,NVDA,SPY&feed=iex`, { headers });
const snapData = await snap.json();
for (const [sym, data] of Object.entries(snapData)) {
  const price = data.latestTrade?.p ?? data.latestQuote?.ap ?? "unknown";
  console.log(`${sym} current price: $${price}`);
}

const aaplPrice = snapData["AAPL"]?.latestTrade?.p ?? snapData["AAPL"]?.latestQuote?.ap;
console.log(`\nUsing AAPL price: $${aaplPrice}`);
const band7 = aaplPrice * 0.07;
console.log(`±7% ATM band: $${(aaplPrice - band7).toFixed(2)} – $${(aaplPrice + band7).toFixed(2)}`);
const band15 = aaplPrice * 0.15;
console.log(`±15% band:    $${(aaplPrice - band15).toFixed(2)} – $${(aaplPrice + band15).toFixed(2)}`);

// 2. Get AAPL option contracts for 28-50 DTE
const today = new Date();
const min = new Date(today.getTime() + 28 * 86400_000).toISOString().split("T")[0];
const max = new Date(today.getTime() + 50 * 86400_000).toISOString().split("T")[0];
const params = new URLSearchParams({ underlying_symbols: "AAPL", expiration_date_gte: min, expiration_date_lte: max, limit: "100" });
const res = await fetch(`${BASE}/options/contracts?${params}`, { headers });
const data = await res.json();
const contracts = data.option_contracts ?? [];
console.log(`\nTotal contracts in ${min}–${max} window: ${contracts.length}`);
// Show strike range of returned contracts
const strikes = contracts.map(c => parseFloat(c.strike_price)).sort((a,b) => a-b);
if (strikes.length) console.log(`Strike range: $${strikes[0]} – $${strikes[strikes.length-1]}`);

// 3. Show what's in each band
const inBand7  = contracts.filter(c => Math.abs(parseFloat(c.strike_price) - aaplPrice) <= band7);
const inBand15 = contracts.filter(c => Math.abs(parseFloat(c.strike_price) - aaplPrice) <= band15);
console.log(`In ±7% band:  ${inBand7.length} contracts`);
console.log(`In ±15% band: ${inBand15.length} contracts`);

// 4. Show ±15% band contracts with pricing status
console.log("\n±15% band contracts (strike | type | close_price):");
for (const c of inBand15.sort((a, b) => parseFloat(a.strike_price) - parseFloat(b.strike_price))) {
  const dist = ((parseFloat(c.strike_price) - aaplPrice) / aaplPrice * 100).toFixed(1);
  console.log(`  ${c.strike_price.padStart(8)} ${c.type.padEnd(4)} close=${String(c.close_price ?? "null").padStart(8)}  (${dist}%)`);
}

// 5. Try options snapshots for near-ATM symbols
const nearSymbols = inBand15.map(c => c.symbol).slice(0, 30);
if (nearSymbols.length > 0) {
  const snapRes = await fetch(`${DATA}/options/snapshots?symbols=${nearSymbols.join(",")}&feed=indicative`, { headers });
  const snapJson = await snapRes.json();
  const snaps = snapJson.snapshots ?? {};
  console.log(`\nOptions snapshots (${Object.keys(snaps).length} returned):`);
  for (const [sym, s] of Object.entries(snaps)) {
    const q = s.latestQuote;
    const bid = q?.bp ?? 0;
    const ask = q?.ap ?? 0;
    const trade = s.latestTrade?.p ?? "n/a";
    if (bid > 0 || ask > 0) {
      console.log(`  ${sym}  bid=${bid}  ask=${ask}  last=${trade}`);
    }
  }
  const priced = Object.values(snaps).filter(s => (s.latestQuote?.ap ?? 0) > 0 || (s.latestQuote?.bp ?? 0) > 0);
  console.log(`  ${priced.length}/${Object.keys(snaps).length} contracts have live bid/ask`);
}
