/**
 * GET/POST /api/scanner/run
 *
 * Runs the pre-market ticker scanner for one or both trader types,
 * scores candidates, and writes the shortlist to scanner_cache.
 *
 * Called by GitHub Actions at ~9:00 AM ET (14:00 UTC) before market open.
 * Auth: Authorization: Bearer $CRON_SECRET
 *
 * Query params:
 *   ?trader_type=micro|macro   (default: runs both)
 */

import { NextRequest, NextResponse } from "next/server";
import { getAllTraders } from "@/src/lib/traders";
import { alpacaForTrader } from "@/src/lib/alpaca";
import { runMicroScan, runMacroScan, saveScanResults } from "@/src/lib/engine/scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handler(req: NextRequest) {
  const auth   = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url          = new URL(req.url);
  const typeParam    = url.searchParams.get("trader_type");
  const runMicro     = !typeParam || typeParam === "micro";
  const runMacro     = !typeParam || typeParam === "macro";
  const startedAt    = Date.now();

  const traders = await getAllTraders();
  const microTrader = traders.find(t => t.type === "micro");
  const macroTrader = traders.find(t => t.type === "macro");

  const results: Record<string, unknown> = {};

  if (runMicro && microTrader) {
    try {
      const alpaca  = alpacaForTrader(microTrader);
      const entries = await runMicroScan(alpaca);
      await saveScanResults("micro", entries);
      results.micro = {
        count: entries.length,
        top10: entries.slice(0, 10).map(e => ({ symbol: e.symbol, score: e.score.toFixed(1), reason: e.reason })),
      };
      console.log(`[scanner] micro: ${entries.length} candidates — top: ${entries.slice(0, 5).map(e => e.symbol).join(", ")}`);
    } catch (e) {
      results.microError = String(e);
      console.error("[scanner] micro failed:", e);
    }
  }

  if (runMacro && macroTrader) {
    try {
      const alpaca  = alpacaForTrader(macroTrader);
      const entries = await runMacroScan(alpaca);
      await saveScanResults("macro", entries);
      const dips = entries.filter(e => e.category === "dip");
      const momo = entries.filter(e => e.category === "momentum");
      results.macro = {
        count: entries.length,
        dips:  dips.slice(0, 5).map(e => ({ symbol: e.symbol, reason: e.reason })),
        momentum: momo.slice(0, 5).map(e => ({ symbol: e.symbol, reason: e.reason })),
      };
      console.log(`[scanner] macro: ${dips.length} dips, ${momo.length} momentum`);
    } catch (e) {
      results.macroError = String(e);
      console.error("[scanner] macro failed:", e);
    }
  }

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    ...results,
  });
}

export const GET  = handler;
export const POST = handler;
