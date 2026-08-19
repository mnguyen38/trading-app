// Debug: fetch calls AND puts separately for AAPL Sep 25, see what's in the ATM band.
const key    = process.env.ALPACA_TRADING_KEY_ID_ACCOUNT_1;
const secret = process.env.ALPACA_TRADING_SECRET_ACCOUNT_1;
const BASE   = "https://paper-api.alpaca.markets/v2";
const DBASE  = "https://data.alpaca.markets/v2";
const headers = { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret };

// Real price
const snap = await fetch(`${DBASE}/stocks/AAPL/snapshot?feed=iex`, { headers });
const snapData = await snap.json();
const price = snapData.latestTrade?.p ?? snapData.latestQuote?.ap;
console.log(`AAPL price: $${price}`);
const band7 = price * 0.07;
console.log(`±7% ATM band: $${(price - band7).toFixed(0)} – $${(price + band7).toFixed(0)}\n`);

// Fetch calls and puts separately
const today = new Date();
const minDate = new Date(today.getTime() + 28 * 86400_000).toISOString().split("T")[0];
const maxDate = new Date(today.getTime() + 50 * 86400_000).toISOString().split("T")[0];

async function fetchType(type) {
  const p = new URLSearchParams({ underlying_symbols: "AAPL", expiration_date_gte: minDate, expiration_date_lte: maxDate, type, limit: "100" });
  const r = await fetch(`${BASE}/options/contracts?${p}`, { headers });
  const d = await r.json();
  return d.option_contracts ?? [];
}

const [calls, puts] = await Promise.all([fetchType("call"), fetchType("put")]);
console.log(`Calls returned: ${calls.length}  Puts returned: ${puts.length}`);

// Show expiries
const callExpiries = [...new Set(calls.map(c => c.expiration_date))].sort();
const putExpiries  = [...new Set(puts.map(c => c.expiration_date))].sort();
console.log(`Call expiries: ${callExpiries.join(", ")}`);
console.log(`Put expiries:  ${putExpiries.join(", ")}\n`);

// For each expiry, show what strikes are in the ATM band and their close_price
const allExpiries = [...new Set([...callExpiries, ...putExpiries])].sort();
for (const expiry of allExpiries) {
  const expCalls = calls.filter(c => c.expiration_date === expiry);
  const expPuts  = puts.filter(c => c.expiration_date === expiry);
  const inBandCalls = expCalls.filter(c => Math.abs(parseFloat(c.strike_price) - price) <= band7);
  const inBandPuts  = expPuts.filter(c => Math.abs(parseFloat(c.strike_price) - price) <= band7);

  // Find priced pairs
  const pairedStrikes = [];
  for (const call of inBandCalls.filter(c => c.close_price)) {
    const strike = parseFloat(call.strike_price);
    const put = inBandPuts.find(p => parseFloat(p.strike_price) === strike && p.close_price);
    if (put) pairedStrikes.push(strike);
  }

  console.log(`── ${expiry} ──`);
  console.log(`  In-band calls: ${inBandCalls.length}  priced: ${inBandCalls.filter(c=>c.close_price).length}`);
  console.log(`  In-band puts:  ${inBandPuts.length}  priced: ${inBandPuts.filter(c=>c.close_price).length}`);
  console.log(`  Priced pairs at: ${pairedStrikes.length > 0 ? pairedStrikes.join(", ") : "NONE"}`);

  // Show individual pricing for in-band
  if (inBandCalls.length > 0 || inBandPuts.length > 0) {
    const strikes = [...new Set([...inBandCalls, ...inBandPuts].map(c => parseFloat(c.strike_price)))].sort((a,b)=>a-b);
    for (const s of strikes) {
      const call = inBandCalls.find(c => parseFloat(c.strike_price) === s);
      const put  = inBandPuts.find(c => parseFloat(c.strike_price) === s);
      const callPrice = call?.close_price ?? "---";
      const putPrice  = put?.close_price  ?? "---";
      const hasPair   = call?.close_price && put?.close_price ? " ← PAIR" : "";
      console.log(`    $${String(s).padStart(5)}  call=${String(callPrice).padStart(8)}  put=${String(putPrice).padStart(8)}${hasPair}`);
    }
  }
  console.log();
}
