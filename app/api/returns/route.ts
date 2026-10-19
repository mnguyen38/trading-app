/**
 * GET /api/returns
 * Auth: Bearer $CRON_SECRET — called server-to-server by the publish-sharpe GitHub workflow.
 *
 * Whole-account returns from the daily equity snapshots (same source as /api/sharpe, so the two
 * are always consistent). Percent values are plain percent numbers, 2dp: 13.51 means +13.51%.
 * Exposes no balances or positions.
 *
 * {
 *   "totalReturnPct": 13.51,          // leader's return since its first snapshot; null if no trader has 2+ snapshots
 *   "lastDayReturnPct": 0.25,         // leader's change over the most recent snapshot interval
 *   "trader": { "name": "Trader 1", "type": "micro" } | null,     // the leader (highest totalReturnPct)
 *   "traders": [                      // every trader with 2+ snapshots, best first
 *     { "name": "Trader 1", "type": "micro", "totalReturnPct": 13.51, "lastDayReturnPct": 0.25, "tradingDays": 32, "since": "2026-08-12" },
 *     { "name": "Trader 2", "type": "macro", "totalReturnPct": 1.44,  "lastDayReturnPct": 0.11, "tradingDays": 32, "since": "2026-08-12" }
 *   ],
 *   "asOf": "2026-09-24",             // date of the latest snapshot used
 *   "since": "2026-08-12",            // date of the leader's first snapshot
 *   "tradingDays": 32,                // daily snapshots in the leader's history
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
    const rows = (await loadTraderPerformance())
      .filter(s => s.perf.totalReturnPct !== null)
      .map(({ trader, perf }) => {
        const pts = perf.points;
        const prev = pts[pts.length - 2];
        const last = pts[pts.length - 1];
        return {
          name: trader.name,
          type: trader.type,
          totalReturnPct: round2(perf.totalReturnPct! * 100),
          lastDayReturnPct: prev && prev.equity !== 0 ? round2(((last.equity - prev.equity) / prev.equity) * 100) : null,
          tradingDays: pts.length,
          since: pts[0].date,
          asOf: last.date,
        };
      })
      .sort((a, b) => b.totalReturnPct - a.totalReturnPct);

    const best = rows[0];

    return NextResponse.json(
      {
        totalReturnPct: best?.totalReturnPct ?? null,
        lastDayReturnPct: best?.lastDayReturnPct ?? null,
        trader: best ? { name: best.name, type: best.type } : null,
        traders: rows.map(({ asOf: _asOf, ...r }) => r),
        asOf: rows.map(r => r.asOf).sort().at(-1) ?? null,
        since: best?.since ?? null,
        tradingDays: best?.tradingDays ?? 0,
        computedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
