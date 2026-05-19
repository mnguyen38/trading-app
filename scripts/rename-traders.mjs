import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { traders } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
const db = drizzle(sql);

await db.update(traders).set({ name: "Trader 1" }).where(eq(traders.id, "sam"));
await db.update(traders).set({ name: "Trader 2" }).where(eq(traders.id, "friend"));

console.log("Renamed.");
await sql.end();
