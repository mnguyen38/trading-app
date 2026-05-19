import { db } from "@/src/db/client";
import { traders } from "@/src/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

export type Trader = {
  id: string;
  name: string;
  accountKey: string;
};

const cols = {
  id: traders.id,
  name: traders.name,
  accountKey: traders.accountKey,
};

export async function getAllTraders(): Promise<Trader[]> {
  return db.select(cols).from(traders).orderBy(traders.name);
}

export async function getTraderById(id: string): Promise<Trader | undefined> {
  const rows = await db.select(cols).from(traders).where(eq(traders.id, id));
  return rows[0];
}

export async function verifyTraderPasscode(id: string, passcode: string): Promise<Trader | undefined> {
  if (!id || !passcode) return undefined;
  const rows = await db.select().from(traders).where(eq(traders.id, id));
  if (!rows[0]) return undefined;
  const valid = await bcrypt.compare(passcode, rows[0].passcodeHash);
  if (!valid) return undefined;
  return { id: rows[0].id, name: rows[0].name, accountKey: rows[0].accountKey };
}
