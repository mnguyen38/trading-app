/**
 * Tests the Alpaca options contracts API directly.
 * Usage: node --env-file=.env scripts/test-options-api.mjs
 */

const BASE = process.env.ALPACA_TRADING_BASE_URL ?? "https://paper-api.alpaca.markets/v2";
const KEY    = process.env.ALPACA_TRADING_KEY_ID_ACCOUNT_1;
const SECRET = process.env.ALPACA_TRADING_SECRET_ACCOUNT_1;

if (!KEY || !SECRET) {
  console.error("Missing ALPACA_TRADING_KEY_ID_ACCOUNT_1 or ALPACA_TRADING_SECRET_ACCOUNT_1");
  process.exit(1);
}

const headers = {
  "APCA-API-KEY-ID": KEY,
  "APCA-API-SECRET-KEY": SECRET,
  "Content-Type": "application/json",
  Accept: "application/json",
};

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, ok: res.ok, body: parsed };
}

const today = new Date();
const min = new Date(today.getTime() + 28 * 86400_000).toISOString().split("T")[0];
const max = new Date(today.getTime() + 50 * 86400_000).toISOString().split("T")[0];

console.log(`Using BASE: ${BASE}`);
console.log(`Date window: ${min} → ${max}\n`);

// 1. Account check
console.log("── Account ──────────────────────────────────────────");
const acct = await get("/account");
console.log(`Status: ${acct.status}`);
if (acct.ok) {
  console.log(`  equity: $${acct.body.equity}`);
  console.log(`  options_approved_level: ${acct.body.options_approved_level ?? "not in response"}`);
  console.log(`  options_trading_level:  ${acct.body.options_trading_level ?? "not in response"}`);
}

// 2. Options contracts for AAPL
console.log("\n── AAPL options contracts (28–50 DTE) ───────────────");
const params = new URLSearchParams({
  underlying_symbols: "AAPL",
  expiration_date_gte: min,
  expiration_date_lte: max,
  limit: "5",
});
const contracts = await get(`/options/contracts?${params}`);
console.log(`Status: ${contracts.status}`);
if (!contracts.ok) {
  console.log("ERROR:", JSON.stringify(contracts.body, null, 2));
} else {
  const list = contracts.body?.option_contracts ?? [];
  console.log(`Contracts returned: ${list.length}`);
  if (list.length > 0) {
    const first = list[0];
    console.log("First contract:", JSON.stringify(first, null, 2));
  } else {
    console.log("Empty array — no contracts in this window");
    console.log("Full response:", JSON.stringify(contracts.body, null, 2));
  }
}

// 3. Try without date filter (to see if any contracts exist at all)
console.log("\n── AAPL options contracts (no date filter, limit 3) ─");
const any = await get("/options/contracts?underlying_symbols=AAPL&limit=3");
console.log(`Status: ${any.status}`);
if (!any.ok) {
  console.log("ERROR:", JSON.stringify(any.body, null, 2));
} else {
  const list = any.body?.option_contracts ?? [];
  console.log(`Contracts returned: ${list.length}`);
  if (list.length > 0) {
    console.log("First:", JSON.stringify(list[0], null, 2));
  }
}
