import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db/client";
import { equitySnapshots } from "@/src/db/schema";
import { getAllTraders } from "@/src/lib/traders";
import { alpacaForTrader } from "@/src/lib/alpaca";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allTraders = await getAllTraders();

  type Result = { traderId: string; name: string; equity: number; status: "ok" | "error"; error?: string };
  const results: Result[] = [];

  for (const trader of allTraders) {
    try {
      const alpaca = alpacaForTrader(trader);
      const account = await alpaca.getAccount();
      const equity = parseFloat(account.equity);
      const cash = parseFloat(account.cash);

      await db.insert(equitySnapshots).values({
        id: crypto.randomUUID(),
        traderId: trader.id,
        equity,
        cash,
      });

      results.push({ traderId: trader.id, name: trader.name, equity, status: "ok" });
    } catch (e) {
      results.push({ traderId: trader.id, name: trader.name, equity: 0, status: "error", error: String(e) });
    }
  }

  const ok = results.filter(r => r.status === "ok").length;
  return NextResponse.json({ snapped: ok, total: allTraders.length, results });
}
