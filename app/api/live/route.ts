import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/src/lib/auth";
import { getTraderById } from "@/src/lib/traders";
import { alpacaForTrader } from "@/src/lib/alpaca";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = await cookies();
  const value = store.get("session")?.value;
  if (!value) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const traderId = verifyToken(value, secret);
  if (!traderId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const trader = await getTraderById(traderId);
  if (!trader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const alpaca = alpacaForTrader(trader);
    const [account, positions, openOrders, clock] = await Promise.all([
      alpaca.getAccount(),
      alpaca.getPositions(),
      alpaca.getOrders("open"),
      alpaca.getClock(),
    ]);
    return NextResponse.json({ account, positions, openOrders, isOpen: clock.is_open });
  } catch {
    return NextResponse.json({ error: "Alpaca fetch failed" }, { status: 502 });
  }
}
