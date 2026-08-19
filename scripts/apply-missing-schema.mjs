/**
 * Applies schema changes that drizzle-kit skipped because the migration journal
 * was already marked applied. Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards).
 *
 * Usage: node --env-file=.env scripts/apply-missing-schema.mjs
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });

async function run() {
  console.log("Applying missing schema...\n");

  // 1. trader_type enum
  await sql.unsafe(`
    DO $$ BEGIN
      CREATE TYPE "public"."trader_type" AS ENUM('micro', 'macro');
    EXCEPTION WHEN duplicate_object THEN
      RAISE NOTICE 'trader_type enum already exists, skipping';
    END $$;
  `);
  console.log("✓ trader_type enum");

  // 2. type column on traders
  await sql.unsafe(`
    ALTER TABLE "traders"
      ADD COLUMN IF NOT EXISTS "type" "trader_type" DEFAULT 'micro' NOT NULL;
  `);
  console.log("✓ traders.type column");

  // 3. strategy_trades table
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "strategy_trades" (
      "id" text PRIMARY KEY NOT NULL,
      "trader_id" text NOT NULL REFERENCES "traders"("id"),
      "strategy_slug" text NOT NULL,
      "order_id" text NOT NULL,
      "symbol" text NOT NULL,
      "side" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  console.log("✓ strategy_trades table");

  // 4. engine_state table
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "engine_state" (
      "id" text PRIMARY KEY NOT NULL,
      "trader_id" text NOT NULL REFERENCES "traders"("id"),
      "strategy_slug" text NOT NULL,
      "key" text NOT NULL,
      "value" text NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  console.log("✓ engine_state table");

  // 5. engine_runs table
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "engine_runs" (
      "id" text PRIMARY KEY NOT NULL,
      "trader_id" text NOT NULL REFERENCES "traders"("id"),
      "phase" text NOT NULL,
      "run_at" timestamp DEFAULT now() NOT NULL,
      "signals" jsonb,
      "trades" jsonb,
      "skipped" jsonb,
      "errors" jsonb
    );
  `);
  console.log("✓ engine_runs table");

  // 6. scanner_cache table
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "scanner_cache" (
      "id" text PRIMARY KEY NOT NULL,
      "trader_type" "trader_type" NOT NULL,
      "tickers" jsonb NOT NULL,
      "scanned_at" timestamp DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "scanner_cache_trader_type_scanned_at_idx"
      ON "scanner_cache" ("trader_type", "scanned_at" DESC);
  `);
  console.log("✓ scanner_cache table + index");

  // 7. Show current traders so you know what to set
  const traders = await sql`SELECT id, name, type FROM traders ORDER BY name`;
  console.log("\nCurrent traders:");
  for (const t of traders) {
    console.log(`  ${t.name.padEnd(20)} type=${t.type}`);
  }
  console.log('\nNow run: node --env-file=.env scripts/set-trader-type.mjs "Name" macro');
}

run()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => sql.end());
