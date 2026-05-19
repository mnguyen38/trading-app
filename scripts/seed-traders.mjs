/**
 * Seeds the traders table with initial users.
 * Run once: node --env-file=.env scripts/seed-traders.mjs
 *
 * Edit TRADERS below to add/change users before running.
 * To add a new trader later, just add a row here and re-run — existing rows are skipped.
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { traders } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const TRADERS = [
  { id: "sam",    name: "Trader 1", passcode: process.env.TRADER_SAM_PASSCODE,    accountKey: "ACCOUNT_1" },
  { id: "friend", name: "Trader 2", passcode: process.env.TRADER_FRIEND_PASSCODE, accountKey: "ACCOUNT_2" },
];

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
const db = drizzle(sql);

for (const t of TRADERS) {
  if (!t.passcode) {
    console.warn(`Skipping ${t.name} — no passcode env var set`);
    continue;
  }

  const existing = await db.select().from(traders).where(eq(traders.id, t.id));
  if (existing.length > 0) {
    console.log(`${t.name} already exists — skipped`);
    continue;
  }

  const passcodeHash = await bcrypt.hash(t.passcode, 10);
  await db.insert(traders).values({
    id: t.id,
    name: t.name,
    passcodeHash,
    accountKey: t.accountKey,
  });
  console.log(`Seeded ${t.name}`);
}

await sql.end();
console.log("Done.");
