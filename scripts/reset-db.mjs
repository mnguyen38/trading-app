// Clears all user-generated data while keeping trader accounts.
// Run: npm run reset:db
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });

const tables = [
  "concept_views",
  "lesson_progress",
  "notes",
  "equity_snapshots",
  "settings",
];

console.log("Connecting to database…");

for (const table of tables) {
  const result = await sql`DELETE FROM ${sql(table)}`;
  console.log(`  ✓ ${table} — ${result.count} rows deleted`);
}

console.log("\nDone. Trader accounts are intact.");
await sql.end();
