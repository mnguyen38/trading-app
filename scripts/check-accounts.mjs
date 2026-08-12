/**
 * Queries both Alpaca paper accounts and prints equity, cash, and buying power.
 * Run: node --env-file=.env scripts/check-accounts.mjs
 */

const BASE = process.env.ALPACA_TRADING_BASE_URL ?? "https://paper-api.alpaca.markets/v2";

const ACCOUNTS = [
  { name: "User 1 (Micro / ACCOUNT_1)", key: process.env.ALPACA_TRADING_KEY_ID_ACCOUNT_1, secret: process.env.ALPACA_TRADING_SECRET_ACCOUNT_1 },
  { name: "User 2 (Macro / ACCOUNT_2)", key: process.env.ALPACA_TRADING_KEY_ID_ACCOUNT_2, secret: process.env.ALPACA_TRADING_SECRET_ACCOUNT_2 },
];

async function getAccount(key, secret) {
  const res = await fetch(`${BASE}/account`, {
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function getPositions(key, secret) {
  const res = await fetch(`${BASE}/positions`, {
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

const fmt = n => `$${parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

for (const account of ACCOUNTS) {
  console.log(`\n── ${account.name} ────────────────────────`);
  if (!account.key || !account.secret) {
    console.log("  ⚠ Missing API credentials in .env");
    continue;
  }
  try {
    const [acc, positions] = await Promise.all([
      getAccount(account.key, account.secret),
      getPositions(account.key, account.secret),
    ]);

    const equity = parseFloat(acc.equity);
    const cash   = parseFloat(acc.cash);
    const bp     = parseFloat(acc.buying_power);
    const portfolioValue = parseFloat(acc.portfolio_value);

    console.log(`  Portfolio value : ${fmt(portfolioValue)}`);
    console.log(`  Equity          : ${fmt(equity)}`);
    console.log(`  Cash            : ${fmt(cash)}`);
    console.log(`  Buying power    : ${fmt(bp)}`);
    console.log(`  Open positions  : ${positions.length}`);

    if (positions.length > 0) {
      const totalMarketValue = positions.reduce((s, p) => s + parseFloat(p.market_value), 0);
      const totalUnrealPl    = positions.reduce((s, p) => s + parseFloat(p.unrealized_pl), 0);
      console.log(`  Deployed value  : ${fmt(totalMarketValue)}`);
      console.log(`  Unrealised P&L  : ${fmt(totalUnrealPl)}`);
      console.log(`  Positions:`);
      for (const p of positions) {
        const mv = parseFloat(p.market_value);
        const pl = parseFloat(p.unrealized_pl);
        const pct = (mv / equity * 100).toFixed(1);
        console.log(`    ${p.symbol.padEnd(8)} ${fmt(mv).padStart(12)}  (${pct}% of equity)  P&L ${fmt(pl)}`);
      }
    }
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
  }
}

console.log("\n");
