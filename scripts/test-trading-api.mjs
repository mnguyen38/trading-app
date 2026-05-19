// End-to-end smoke test for Alpaca Trading API (paper trading).
// Discovers every ALPACA_TRADING_KEY_ID_ACCOUNT_<N> in .env and runs the full
// flow against each: auth -> read account -> place market order -> confirm position.
//
// Run with:   npm run test:trading

const BASE = process.env.ALPACA_TRADING_BASE_URL ?? "https://paper-api.alpaca.markets/v2";

// Discover all configured accounts. Pairs each KEY_ID_ACCOUNT_<N> with its matching SECRET.
const accounts = Object.keys(process.env)
  .map(k => k.match(/^ALPACA_TRADING_KEY_ID_ACCOUNT_(.+)$/))
  .filter(Boolean)
  .map(m => ({
    label: m[1],
    key: process.env[m[0]],
    secret: process.env[`ALPACA_TRADING_SECRET_ACCOUNT_${m[1]}`],
  }))
  .filter(a => a.key && a.secret)
  .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

if (accounts.length === 0) {
  console.error("No paper accounts configured. Add ALPACA_TRADING_KEY_ID_ACCOUNT_1 + ALPACA_TRADING_SECRET_ACCOUNT_1 to .env.");
  process.exit(1);
}

async function req(creds, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "APCA-API-KEY-ID": creds.key,
      "APCA-API-SECRET-KEY": creds.secret,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

function step(label) { console.log(`\n--- ${label} ---`); }

async function runFor(account) {
  console.log(`\n========================================`);
  console.log(`ACCOUNT_${account.label}  (key ${account.key.slice(0, 6)}…)`);
  console.log(`========================================`);

  // 1. Auth check — reading the account proves keys work and shows starting balances.
  step("1. Auth check (GET /account)");
  const acct = await req(account, "GET", "/account");
  console.log(`  Account ${acct.account_number} (${acct.status})`);
  console.log(`  Cash: $${acct.cash}  Equity: $${acct.equity}  Buying power: $${acct.buying_power}`);
  console.log(`  Pattern day trader: ${acct.pattern_day_trader}  Trading blocked: ${acct.trading_blocked}`);

  // 2. Market clock — paper accepts orders 24/7 but they queue until open if market closed.
  step("2. Market clock (GET /clock)");
  const clock = await req(account, "GET", "/clock");
  console.log(`  Now: ${clock.timestamp}  Market is ${clock.is_open ? "OPEN" : "CLOSED"}`);
  if (!clock.is_open) console.log(`  Next open: ${clock.next_open} — order will queue.`);

  // 3. Place a market buy order for 1 share AAPL.
  // client_order_id makes the request idempotent — retrying with the same id returns the existing order.
  step("3. Place market buy: 1 AAPL");
  const clientOrderId = `smoke-acct${account.label}-${Date.now()}`;
  const order = await req(account, "POST", "/orders", {
    symbol: "AAPL",
    qty: "1",
    side: "buy",
    type: "market",
    time_in_force: "day",
    client_order_id: clientOrderId,
  });
  console.log(`  Order ${order.id} -> status=${order.status}  client_order_id=${clientOrderId}`);

  // 4. Poll for fill. Sandbox fills in ~1s during market hours; outside hours it stays accepted/new.
  step("4. Wait for fill");
  let filled = order;
  for (let i = 0; i < 10 && filled.status !== "filled"; i++) {
    await new Promise(r => setTimeout(r, 1000));
    filled = await req(account, "GET", `/orders/${order.id}`);
    console.log(`  status=${filled.status} filled_qty=${filled.filled_qty}`);
    if (["canceled", "rejected", "expired"].includes(filled.status)) break;
  }
  if (filled.status === "filled") {
    console.log(`  Filled ${filled.filled_qty} @ $${filled.filled_avg_price}`);
  } else {
    console.log(`  Order did not fill within 10s (status=${filled.status}). Normal if market is closed.`);
  }

  // 5. Read back account state + positions.
  step("5. Read back state");
  const after = await req(account, "GET", "/account");
  console.log(`  Cash: $${after.cash}  Equity: $${after.equity}  Buying power: $${after.buying_power}`);
  const positions = await req(account, "GET", "/positions");
  console.log(`  Positions: ${positions.length === 0 ? "(none — order may still be pending)" : positions.map(p => `${p.qty} ${p.symbol} @ avg $${p.avg_entry_price} (P/L $${p.unrealized_pl})`).join(", ")}`);
}

async function main() {
  console.log(`Testing ${accounts.length} paper account(s) at ${BASE}`);
  const results = [];
  for (const a of accounts) {
    try {
      await runFor(a);
      results.push({ label: a.label, ok: true });
    } catch (err) {
      console.error(`\nFAILED on ACCOUNT_${a.label}: ${err.message}`);
      if (err.body) console.error("Response body:", JSON.stringify(err.body, null, 2));
      if (err.status === 401) console.error("→ Auth rejected. Verify these are Paper Trading keys (not Broker, not live).");
      if (err.status === 403) console.error("→ Forbidden. Account may be flagged (PDT) or keys lack required scopes.");
      results.push({ label: a.label, ok: false });
    }
  }

  console.log(`\n========================================`);
  console.log(`Summary: ${results.filter(r => r.ok).length}/${results.length} accounts passed`);
  for (const r of results) console.log(`  ACCOUNT_${r.label}: ${r.ok ? "✓ pass" : "✗ fail"}`);
  if (results.some(r => !r.ok)) process.exit(1);
}

main();
