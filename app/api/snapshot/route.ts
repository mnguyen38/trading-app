import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db/client";
import { equitySnapshots } from "@/src/db/schema";
import { getAllTraders } from "@/src/lib/traders";
import { alpacaForTrader } from "@/src/lib/alpaca";
import { etDateString } from "@/src/lib/marketHours";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allTraders = await getAllTraders();

  // Only snapshot on days the NYSE actually opened. The cron fires every weekday, so market
  // holidays (e.g. Labor Day) are skipped here using Alpaca's trading calendar. If the calendar
  // can't be read we fail open — a rare extra snapshot beats a missing one. `?force=1` overrides.
  let calendarCheck: "trading_day" | "unverified" = "unverified";
  if (req.nextUrl.searchParams.get("force") !== "1" && allTraders.length > 0) {
    try {
      const today = etDateString();
      const days = await alpacaForTrader(allTraders[0]).getCalendar(today, today);
      if (!days.some(d => d.date === today)) {
        return NextResponse.json({ snapped: 0, skipped: true, reason: `NYSE closed on ${today}` });
      }
      calendarCheck = "trading_day";
    } catch {
      // fall through and snapshot
    }
  }

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
  return NextResponse.json({ snapped: ok, total: allTraders.length, calendarCheck, results });
}
