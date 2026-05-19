import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", connect_timeout: 10 });

try {
  const result = await sql`SELECT current_database(), current_user`;
  console.log("Connected:", result[0]);
} catch (err) {
  console.error("Connection failed:", err.message);
} finally {
  await sql.end();
}
