/**
 * POST /api/engine/run
 * Called by Vercel Cron on two schedules:
 *   Entry — 9:35 AM ET (14:35 UTC) Mon-Fri: scan signals, place new trades
 *   Exit  — 3:45 PM ET (20:45 UTC) Mon-Fri: close positions that hit their rules
 *
 * Body: { phase: "entry" | "exit" }  (optional — defaults to "entry")
 *
 * Auth: Authorization: Bearer $CRON_SECRET
 * Also accepts ?phase=exit as a query param for manual testing.
 */

import { NextRequest, NextResponse } from "next/server";
import { runEngine } from "@/src/lib/engine/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5-minute timeout — engine scans many tickers

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let phase: "entry" | "exit" = "entry";
  try {
    const body = await req.json().catch(() => ({}));
    if (body.phase === "exit") phase = "exit";
  } catch { /* ignore parse errors */ }

  // Also support ?phase=exit&trader_type=micro|macro for Vercel cron
  const url = new URL(req.url);
  if (url.searchParams.get("phase") === "exit") phase = "exit";
  const traderTypeParam = url.searchParams.get("trader_type");
  const traderType = (traderTypeParam === "micro" || traderTypeParam === "macro")
    ? traderTypeParam
    : undefined;

  try {
    const results = await runEngine(phase, traderType);

    const totalSignals = results.reduce((s, r) => s + r.signals.length, 0);
    const totalTrades  = results.reduce((s, r) => s + r.trades.length, 0);
    const totalExits   = results.reduce((s, r) => s + r.exits.length, 0);
    const totalErrors  = results.reduce((s, r) => s + r.errors.length, 0);

    return NextResponse.json({
      phase,
      traders: results.length,
      signals: totalSignals,
      trades:  totalTrades,
      exits:   totalExits,
      errors:  totalErrors,
      detail:  results,
    });
  } catch (e) {
    console.error("[engine/run]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// Vercel Cron hits GET routes — alias POST logic for cron compatibility
export async function GET(req: NextRequest) {
  return POST(req);
}
