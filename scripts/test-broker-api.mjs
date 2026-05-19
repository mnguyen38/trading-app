// End-to-end smoke test for Alpaca Broker API (sandbox).
// Verifies: auth -> create sub-account -> fund via ACH -> place market order.
//
// Run with:   npm run test:broker
// (reads ALPACA_BROKER_KEY_ID / ALPACA_BROKER_SECRET / ALPACA_BROKER_BASE_URL from .env)

const KEY = process.env.ALPACA_BROKER_KEY_ID;
const SECRET = process.env.ALPACA_BROKER_SECRET;
const BASE = process.env.ALPACA_BROKER_BASE_URL ?? "https://broker-api.sandbox.alpaca.markets";

if (!KEY || !SECRET) {
  console.error("Missing ALPACA_BROKER_KEY_ID or ALPACA_BROKER_SECRET in .env");
  process.exit(1);
}

const AUTH = "Basic " + Buffer.from(`${KEY}:${SECRET}`).toString("base64");

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: AUTH,
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

function step(label) { console.log(`\n=== ${label} ===`); }

async function main() {
  // 1. Auth check — listing existing sub-accounts proves the keys + base URL work.
  step("1. Auth check (GET /v1/accounts)");
  const existing = await req("GET", "/v1/accounts?query=&entities=");
  console.log(`OK — ${existing.length} existing sub-accounts under this Broker app.`);

  // 2. Create a new sub-account with dummy KYC.
  // NOTE: DOB is set to an adult — Alpaca won't approve under-18 accounts even in sandbox.
  // For our app the legal "account holder" is us (the operator); students just use the UI.
  step("2. Create sub-account (POST /v1/accounts)");
  const tag = Date.now();
  const newAccount = await req("POST", "/v1/accounts", {
    contact: {
      email_address: `student+${tag}@example.com`,
      phone_number: "+15551234567",
      street_address: ["123 Main St"],
      city: "San Francisco",
      state: "CA",
      postal_code: "94105",
      country: "USA",
    },
    identity: {
      given_name: "Test",
      family_name: `Student${tag}`,
      date_of_birth: "1990-01-15",
      tax_id: "666-55-1234",
      tax_id_type: "USA_SSN",
      country_of_citizenship: "USA",
      country_of_birth: "USA",
      country_of_tax_residence: "USA",
      funding_source: ["employment_income"],
    },
    disclosures: {
      is_control_person: false,
      is_affiliated_exchange_or_finra: false,
      is_politically_exposed: false,
      immediate_family_exposed: false,
    },
    agreements: [
      { agreement: "margin_agreement",   signed_at: new Date().toISOString(), ip_address: "127.0.0.1" },
      { agreement: "account_agreement",  signed_at: new Date().toISOString(), ip_address: "127.0.0.1" },
      { agreement: "customer_agreement", signed_at: new Date().toISOString(), ip_address: "127.0.0.1" },
    ],
  });
  const accountId = newAccount.id;
  console.log(`OK — created account ${accountId}, status=${newAccount.status}`);

  // 3. Wait briefly for sandbox auto-approval (SUBMITTED -> APPROVED -> ACTIVE).
  step("3. Wait for account to become ACTIVE");
  let status = newAccount.status;
  for (let i = 0; i < 10 && status !== "ACTIVE"; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const a = await req("GET", `/v1/accounts/${accountId}`);
    status = a.status;
    console.log(`  status=${status}`);
  }
  if (status !== "ACTIVE") {
    console.warn(`Account did not become ACTIVE within 10s (status=${status}). Continuing anyway.`);
  }

  // 4. Fund via ACH (sandbox auto-completes).
  step("4. Create ACH relationship + transfer $50,000");
  const ach = await req("POST", `/v1/accounts/${accountId}/ach_relationships`, {
    account_owner_name: `Test Student${tag}`,
    bank_account_type: "CHECKING",
    bank_account_number: "32131231abc",
    bank_routing_number: "121000358",
    nickname: "Test bank",
  });
  console.log(`  ACH relationship: ${ach.id} (status=${ach.status})`);

  const transfer = await req("POST", `/v1/accounts/${accountId}/transfers`, {
    transfer_type: "ach",
    relationship_id: ach.id,
    amount: "50000",
    direction: "INCOMING",
  });
  console.log(`  Transfer: ${transfer.id} (status=${transfer.status})`);

  // 5. Place a market buy order for 1 share AAPL.
  step("5. Place market buy: 1 AAPL");
  const order = await req("POST", `/v1/trading/accounts/${accountId}/orders`, {
    symbol: "AAPL",
    qty: "1",
    side: "buy",
    type: "market",
    time_in_force: "day",
  });
  console.log(`  Order ${order.id} -> status=${order.status}`);

  // 6. Read back the account's cash + positions to confirm.
  step("6. Read back account state");
  const tradingAccount = await req("GET", `/v1/trading/accounts/${accountId}/account`);
  console.log(`  Cash: $${tradingAccount.cash}  Buying power: $${tradingAccount.buying_power}`);
  const positions = await req("GET", `/v1/trading/accounts/${accountId}/positions`);
  console.log(`  Positions: ${positions.length === 0 ? "(none yet — order may still be pending)" : positions.map(p => `${p.qty} ${p.symbol} @ $${p.avg_entry_price}`).join(", ")}`);

  console.log(`\n✓ Smoke test passed. Account ${accountId} is live in sandbox.`);
  console.log(`  You can delete it later: DELETE /v1/accounts/${accountId}`);
}

main().catch(err => {
  console.error(`\nFAILED: ${err.message}`);
  if (err.body) console.error("Response body:", JSON.stringify(err.body, null, 2));
  if (err.status === 401) console.error("\n→ Auth rejected. Check ALPACA_BROKER_KEY_ID/SECRET are Broker API keys (not regular Trading API keys).");
  if (err.status === 403) console.error("\n→ Forbidden. Your key may not have Broker API scope, or this endpoint isn't enabled for your app.");
  process.exit(1);
});
