// Feature probe for Alpaca paper Trading API.
// Runs every major capability against ACCOUNT_1 and reports OK / FAIL / N/A.
// Cleans up open orders + positions at the end so the account stays tidy.
//
// Run with:   npm run probe:features

const BASE = process.env.ALPACA_TRADING_BASE_URL ?? "https://paper-api.alpaca.markets/v2";
const KEY = process.env.ALPACA_TRADING_KEY_ID_ACCOUNT_1;
const SECRET = process.env.ALPACA_TRADING_SECRET_ACCOUNT_1;
const DATA_BASE = "https://data.alpaca.markets/v2";

if (!KEY || !SECRET) {
  console.error("Missing ALPACA_TRADING_KEY_ID_ACCOUNT_1 / ALPACA_TRADING_SECRET_ACCOUNT_1 in .env");
  process.exit(1);
}

async function req(host, method, path, body) {
  const res = await fetch(`${host}${path}`, {
    method,
    headers: {
      "APCA-API-KEY-ID": KEY,
      "APCA-API-SECRET-KEY": SECRET,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}`);
    err.status = res.status; err.body = parsed;
    throw err;
  }
  return parsed;
}
const t = (m, p, b) => req(BASE, m, p, b);            // trading API
const d = (m, p)    => req(DATA_BASE, m, p);          // market data API

const results = [];
async function probe(name, fn) {
  process.stdout.write(`  ${name.padEnd(40)} `);
  try {
    const note = await fn();
    console.log(`✓ ${note ?? ""}`);
    results.push({ name, status: "OK" });
  } catch (err) {
    const msg = err.body?.message || err.body?.error || err.message;
    const tag = err.status === 403 || err.status === 422 ? "N/A" : "FAIL";
    console.log(`${tag === "N/A" ? "○" : "✗"} ${tag} — ${msg}`);
    results.push({ name, status: tag, detail: msg });
  }
}

function section(label) { console.log(`\n=== ${label} ===`); }

async function main() {
  console.log(`Probing paper Trading API features against ACCOUNT_1 (${KEY.slice(0,6)}…)\n`);

  // ─── ACCOUNT & METADATA ───
  section("Account & metadata");
  await probe("GET /account", async () => {
    const a = await t("GET", "/account");
    return `${a.account_number} cash=$${a.cash} status=${a.status}`;
  });
  await probe("GET /account/configurations", async () => {
    const c = await t("GET", "/account/configurations");
    return `dtbp_check=${c.dtbp_check} suspend_trade=${c.suspend_trade}`;
  });
  await probe("GET /clock", async () => {
    const c = await t("GET", "/clock");
    return `market ${c.is_open ? "OPEN" : "CLOSED"}`;
  });
  await probe("GET /calendar (next 7d)", async () => {
    const start = new Date().toISOString().slice(0,10);
    const end = new Date(Date.now()+7*864e5).toISOString().slice(0,10);
    const c = await t("GET", `/calendar?start=${start}&end=${end}`);
    return `${c.length} sessions`;
  });
  await probe("GET /assets (count + sample)", async () => {
    const assets = await t("GET", "/assets?status=active&asset_class=us_equity");
    return `${assets.length} active US equities`;
  });
  await probe("GET /assets/AAPL", async () => {
    const a = await t("GET", "/assets/AAPL");
    return `tradable=${a.tradable} fractionable=${a.fractionable}`;
  });

  // ─── ORDER TYPES ─── (track every order we place so cleanup can target them)
  section("Order types — placing");
  const placed = [];   // { id, label }
  const trackOrder = (label, o) => { placed.push({ id: o.id, label }); return `${o.id.slice(0,8)} status=${o.status}`; };

  await probe("Market buy (1 AAPL)", async () => {
    const o = await t("POST", "/orders", {
      symbol: "AAPL", qty: "1", side: "buy", type: "market", time_in_force: "day",
      client_order_id: `probe-mkt-${Date.now()}`,
    });
    return trackOrder("market buy AAPL", o);
  });
  await probe("Limit buy (AAPL @ $1, won't fill)", async () => {
    const o = await t("POST", "/orders", {
      symbol: "AAPL", qty: "1", side: "buy", type: "limit", limit_price: "1.00", time_in_force: "day",
      client_order_id: `probe-lim-${Date.now()}`,
    });
    return trackOrder("limit buy", o);
  });
  await probe("Stop buy (AAPL stop $9999)", async () => {
    const o = await t("POST", "/orders", {
      symbol: "AAPL", qty: "1", side: "buy", type: "stop", stop_price: "9999", time_in_force: "day",
      client_order_id: `probe-stop-${Date.now()}`,
    });
    return trackOrder("stop buy", o);
  });
  await probe("Trailing stop sell (needs position)", async () => {
    const o = await t("POST", "/orders", {
      symbol: "AAPL", qty: "1", side: "sell", type: "trailing_stop", trail_percent: "5", time_in_force: "day",
      client_order_id: `probe-trail-${Date.now()}`,
    });
    return trackOrder("trailing stop", o);
  });
  await probe("Fractional qty (0.5 AAPL)", async () => {
    const o = await t("POST", "/orders", {
      symbol: "AAPL", qty: "0.5", side: "buy", type: "market", time_in_force: "day",
      client_order_id: `probe-frac-${Date.now()}`,
    });
    return trackOrder("fractional", o);
  });
  await probe("Notional order ($10 of AAPL)", async () => {
    const o = await t("POST", "/orders", {
      symbol: "AAPL", notional: "10", side: "buy", type: "market", time_in_force: "day",
      client_order_id: `probe-notional-${Date.now()}`,
    });
    return trackOrder("notional", o);
  });
  await probe("Bracket order (limit + TP + SL)", async () => {
    const o = await t("POST", "/orders", {
      symbol: "AAPL", qty: "1", side: "buy", type: "limit", limit_price: "1.00", time_in_force: "gtc",
      order_class: "bracket",
      take_profit: { limit_price: "9999" },
      stop_loss:   { stop_price:  "0.01" },
      client_order_id: `probe-bracket-${Date.now()}`,
    });
    return trackOrder("bracket", o);
  });

  // ─── OPTIONS ─── (requires options trading approval; commonly N/A on fresh paper)
  section("Options");
  let aaplOptionSymbol = null;
  await probe("GET /options/contracts (AAPL chain)", async () => {
    const c = await t("GET", "/options/contracts?underlying_symbols=AAPL&limit=5");
    if (c.option_contracts?.length) aaplOptionSymbol = c.option_contracts[0].symbol;
    return `${c.option_contracts?.length ?? 0} contracts; first=${aaplOptionSymbol ?? "(none)"}`;
  });
  await probe("Place option order (1 contract)", async () => {
    if (!aaplOptionSymbol) throw Object.assign(new Error("no contract symbol"), { status: 422, body: { message: "no contract loaded" } });
    const o = await t("POST", "/orders", {
      symbol: aaplOptionSymbol, qty: "1", side: "buy", type: "market", time_in_force: "day",
      client_order_id: `probe-opt-${Date.now()}`,
    });
    return trackOrder("option", o);
  });

  // ─── CRYPTO ─── (crypto symbols use `BTC/USD` notation; 24/7 market)
  section("Crypto");
  await probe("GET /assets (crypto count)", async () => {
    const a = await t("GET", "/assets?status=active&asset_class=crypto");
    return `${a.length} crypto pairs`;
  });
  await probe("Crypto market buy ($10 BTC/USD)", async () => {
    const o = await t("POST", "/orders", {
      symbol: "BTC/USD", notional: "10", side: "buy", type: "market", time_in_force: "gtc",
      client_order_id: `probe-btc-${Date.now()}`,
    });
    return trackOrder("crypto", o);
  });

  // ─── MARKET DATA API ─── (separate host, same auth headers)
  section("Market data");
  await probe("Latest quote (AAPL)", async () => {
    const q = await d("GET", "/stocks/AAPL/quotes/latest");
    return `bid=$${q.quote?.bp} ask=$${q.quote?.ap}`;
  });
  await probe("Latest trade (AAPL)", async () => {
    const r = await d("GET", "/stocks/AAPL/trades/latest");
    return `price=$${r.trade?.p} size=${r.trade?.s}`;
  });
  await probe("Snapshot (AAPL)", async () => {
    const s = await d("GET", "/stocks/AAPL/snapshot");
    return `daily close=$${s.dailyBar?.c} day-vol=${s.dailyBar?.v}`;
  });
  await probe("Bars (AAPL 1Day x5, IEX feed)", async () => {
    // Free tier can't query recent SIP data; pin to IEX feed which is always free.
    const r = await d("GET", `/stocks/AAPL/bars?timeframe=1Day&limit=5&feed=iex`);
    return `${r.bars?.length ?? 0} bars`;
  });

  // ─── PORTFOLIO & HISTORY ───
  section("Portfolio & history");
  await probe("GET /account/portfolio/history", async () => {
    const h = await t("GET", "/account/portfolio/history?period=1D&timeframe=5Min");
    return `${h.equity?.length ?? 0} datapoints`;
  });
  await probe("GET /account/activities", async () => {
    const a = await t("GET", "/account/activities");
    return `${a.length} recent activities`;
  });
  await probe("GET /positions", async () => {
    const p = await t("GET", "/positions");
    return `${p.length} open positions`;
  });
  await probe("GET /orders (open)", async () => {
    const o = await t("GET", "/orders?status=open");
    return `${o.length} open orders`;
  });

  // ─── WATCHLISTS ───
  section("Watchlists");
  let wlId = null;
  await probe("Create watchlist", async () => {
    const w = await t("POST", "/watchlists", { name: `probe-${Date.now()}`, symbols: ["AAPL", "MSFT"] });
    wlId = w.id;
    return `id=${w.id.slice(0,8)} (${w.assets?.length ?? 0} assets)`;
  });
  await probe("Add symbol to watchlist", async () => {
    if (!wlId) throw new Error("no watchlist id");
    const w = await t("POST", `/watchlists/${wlId}`, { symbol: "TSLA" });
    return `now ${w.assets?.length ?? 0} assets`;
  });
  await probe("Delete watchlist", async () => {
    if (!wlId) throw new Error("no watchlist id");
    await t("DELETE", `/watchlists/${wlId}`);
    return "deleted";
  });

  // ─── CLEANUP ───
  section("Cleanup (cancel open orders + close positions)");
  await probe("DELETE /orders (cancel all)", async () => {
    const r = await t("DELETE", "/orders");
    return `canceled ${Array.isArray(r) ? r.length : "?"}`;
  });
  await probe("DELETE /positions (close all)", async () => {
    const r = await t("DELETE", "/positions");
    return `closed ${Array.isArray(r) ? r.length : "?"}`;
  });

  // ─── SUMMARY ───
  console.log(`\n========================================`);
  const ok   = results.filter(r => r.status === "OK").length;
  const fail = results.filter(r => r.status === "FAIL").length;
  const na   = results.filter(r => r.status === "N/A").length;
  console.log(`Summary: ${ok} OK, ${fail} FAIL, ${na} N/A (out of ${results.length})`);
  if (fail) {
    console.log(`\nFailures:`);
    results.filter(r => r.status === "FAIL").forEach(r => console.log(`  ✗ ${r.name}: ${r.detail}`));
  }
  if (na) {
    console.log(`\nNot available (probably needs approval/enablement):`);
    results.filter(r => r.status === "N/A").forEach(r => console.log(`  ○ ${r.name}: ${r.detail}`));
  }
}

main().catch(err => {
  console.error(`\nFatal: ${err.message}`);
  if (err.body) console.error("Body:", JSON.stringify(err.body, null, 2));
  process.exit(1);
});
