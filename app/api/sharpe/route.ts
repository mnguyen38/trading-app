/**
 * GET /api/sharpe
 * Auth: Bearer $CRON_SECRET (same as the engine routes) — called server-to-server by the
 * publish-sharpe GitHub workflow, never by a browser.
 *
 * Returns the higher of the two traders' whole-account Sharpe ratios (annualised, from daily
 * equity snapshots). Exposes no balances or positions.
 *
 * {
 *   "sharpe": 4.35,                                   // higher Sharpe, 2dp; null if neither trader has enough history
 *   "trader": { "name": "Trader 1", "type": "micro" } | null,
 *   "asOf": "2026-09-24",                             // date of the latest daily snapshot used
 *   "since": "2026-08-12",                            // date of that trader's first daily snapshot
 *   "tradingDays": 42,                                // daily snapshots in that trader's history (sample size)
 *   "computedAt": "2026-09-25T22:30:00.000Z"
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized, loadTraderPerformance, round2 } from "@/src/lib/publicStats";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const best = (await loadTraderPerformance())
      .filter(s => s.perf.sharpe !== null)
      .sort((a, b) => b.perf.sharpe! - a.perf.sharpe!)[0];

    const lastPoint = best?.perf.points[best.perf.points.length - 1];

    return NextResponse.json(
      {
        sharpe: best ? round2(best.perf.sharpe!) : null,
        trader: best ? { name: best.trader.name, type: best.trader.type } : null,
        asOf: lastPoint?.date ?? null,
        since: best?.perf.points[0]?.date ?? null,
        tradingDays: best ? best.perf.points.length : 0,
        computedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
