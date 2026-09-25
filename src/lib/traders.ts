import { db } from "@/src/db/client";
import { traders } from "@/src/db/schema";
import { eq } from "drizzle-orm";

export type Trader = {
  id: string;
  name: string;
  accountKey: string;
  type: "micro" | "macro";
};

const cols = {
  id: traders.id,
  name: traders.name,
  accountKey: traders.accountKey,
  type: traders.type,
};

export async function getAllTraders(): Promise<Trader[]> {
  return db.select(cols).from(traders).orderBy(traders.name);
}

export async function getTraderById(id: string): Promise<Trader | undefined> {
  const rows = await db.select(cols).from(traders).where(eq(traders.id, id));
  return rows[0];
}
