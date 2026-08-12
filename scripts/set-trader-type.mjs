/**
 * Usage:
 *   node --env-file=.env scripts/set-trader-type.mjs          → list all traders
 *   node --env-file=.env scripts/set-trader-type.mjs "Name" macro
 *   node --env-file=.env scripts/set-trader-type.mjs "Name" micro
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });

const [, , name, type] = process.argv;

if (!name) {
  // List mode
  const rows = await sql`SELECT id, name, type FROM traders ORDER BY name`;
  console.log("\nTraders in DB:\n");
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(20)} type=${r.type ?? "(null)"}   id=${r.id}`);
  }
  console.log("\nTo set a type, run:");
  console.log('  node --env-file=.env scripts/set-trader-type.mjs "Name" macro\n');
} else {
  if (type !== "micro" && type !== "macro") {
    console.error("Type must be 'micro' or 'macro'");
    process.exit(1);
  }
  const result = await sql`
    UPDATE traders SET type = ${type} WHERE name = ${name}
    RETURNING id, name, type
  `;
  if (result.length === 0) {
    console.error(`No trader found with name "${name}"`);
    process.exit(1);
  }
  console.log(`✓ Updated: ${result[0].name} → ${result[0].type}`);
}

await sql.end();
