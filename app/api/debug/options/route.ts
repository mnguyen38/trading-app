/**
 * GET /api/debug/options?symbol=AAPL
 *
 * Calls Alpaca getOptionsContracts directly and returns the raw response
 * so you can see exactly what Alpaca is returning (or erroring with).
 * Auth: Bearer $CRON_SECRET  (same as engine routes)
 */
import { NextRequest, NextResponse } from "next/server";
import { getAllTraders } from "@/src/lib/traders";
import { alpacaForTrader } from "@/src/lib/alpaca";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const symbol = req.nextUrl.searchParams.get("symbol") ?? "AAPL";

  const traders = await getAllTraders();
  const micro = traders.find(t => t.type === "micro");
  if (!micro) return NextResponse.json({ error: "No micro trader found" }, { status: 404 });

  const alpaca = alpacaForTrader(micro);

  const today = new Date();
  const min = new Date(today.getTime() + 28 * 86400_000);
  const max = new Date(today.getTime() + 50 * 86400_000);
  const toDateStr = (d: Date) => d.toISOString().split("T")[0];

  let raw: unknown;
  let error: string | null = null;

  try {
    raw = await alpaca.getOptionsContracts(symbol, {
      expiration_date_gte: toDateStr(min),
      expiration_date_lte: toDateStr(max),
      limit: 10,
    });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    raw = (e as { body?: unknown })?.body ?? null;
  }

  // Fetch snapshot too so we know what price to compare against
  let snapshot: unknown = null;
  try { snapshot = await alpaca.getSnapshot(symbol); } catch { /* ignore */ }

  return NextResponse.json({
    symbol,
    dateWindow: { from: toDateStr(min), to: toDateStr(max) },
    snapshot,
    error,
    raw,
  }, { status: error ? 500 : 200 });
}
