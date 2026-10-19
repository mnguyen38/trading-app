import type { NextRequest } from "next/server";
import { getAllTraders, type Trader } from "@/src/lib/traders";
import { getAccountPerformance, type AccountPerformance } from "@/src/server/actions/performance";

// Shared by the /api/sharpe and /api/returns endpoints, which are called server-to-server by
// the publish-sharpe GitHub workflow.

export function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function loadTraderPerformance(): Promise<{ trader: Trader; perf: AccountPerformance }[]> {
  const traders = await getAllTraders();
  return Promise.all(traders.map(async trader => ({ trader, perf: await getAccountPerformance(trader.id) })));
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
