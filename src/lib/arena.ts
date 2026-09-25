import { unstable_cache } from "next/cache";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { engineRuns, equitySnapshots, strategyTrades } from "@/src/db/schema";
import { alpacaForTrader, type Account, type Order, type Position } from "@/src/lib/alpaca";
import { getAllTraders, type Trader } from "@/src/lib/traders";
import {
  getAccountPerformance, getStrategyPerformance,
  type AccountPerformance, type StrategyPerformance,
} from "@/src/server/actions/performance";
import type { EngineRunRow } from "@/src/components/strategies/EngineLog";

// Stable per-side colours so "orange = micro, sky = macro" holds on every page.
export const SIDE_COLOR: Record<Trader["type"], string> = {
  micro: "#fb923c",
  macro: "#38bdf8",
};

export const SIDE_LABEL: Record<Trader["type"], string> = {
  micro: "Micro · options",
  macro: "Macro · stocks & ETFs",
};

export type Competitor = {
  trader: Trader;
  color: string;
  account: Account | null;
  positions: Position[];
  openOrders: Order[];
  strategyTrades: { strategySlug: string; symbol: string }[];
  equity: number;
  todayPl: number | null;
  allTimePl: number | null;
  returnPct: number | null;
  snapshots: { date: string; equity: number }[];
  perf: AccountPerformance;
  error: string | null;
};

// Loads everything the arena pages need for every trader (micro first, then macro).
// A failing Alpaca call degrades that side to snapshot data instead of failing the page.
async function fetchCompetitors(): Promise<Competitor[]> {
  const traders = (await getAllTraders()).sort(
    (a, b) => Number(a.type !== "micro") - Number(b.type !== "micro"),
  );

  return Promise.all(
    traders.map(async (trader): Promise<Competitor> => {
      const [snaps, tags, perf, live] = await Promise.all([
        db.select().from(equitySnapshots)
          .where(eq(equitySnapshots.traderId, trader.id))
          .orderBy(asc(equitySnapshots.takenAt)),
        db.select({ strategySlug: strategyTrades.strategySlug, symbol: strategyTrades.symbol })
          .from(strategyTrades)
          .where(eq(strategyTrades.traderId, trader.id)),
        getAccountPerformance(trader.id),
        (async () => {
          try {
            const alpaca = alpacaForTrader(trader);
            const [account, positions, openOrders] = await Promise.all([
              alpaca.getAccount(),
              alpaca.getPositions(),
              alpaca.getOrders("open"),
            ]);
            return { account, positions, openOrders, error: null as string | null };
          } catch (err) {
            return {
              account: null as Account | null,
              positions: [] as Position[],
              openOrders: [] as Order[],
              error: err instanceof Error ? err.message : "Alpaca request failed",
            };
          }
        })(),
      ]);

      const first = snaps[0];
      const last = snaps[snaps.length - 1];
      const equity = live.account ? parseFloat(live.account.equity) : (last?.equity ?? 0);

      return {
        trader,
        color: SIDE_COLOR[trader.type],
        account: live.account,
        positions: live.positions,
        openOrders: live.openOrders,
        strategyTrades: tags,
        equity,
        todayPl: last ? equity - last.equity : null,
        allTimePl: first ? equity - first.equity : null,
        returnPct: first && first.equity > 0 ? (equity - first.equity) / first.equity : null,
        snapshots: snaps.map(s => ({ date: s.takenAt.toISOString().slice(0, 10), equity: s.equity })),
        perf,
        error: live.error,
      };
    }),
  );
}

// Short-lived server cache: navigating between pages reuses the same Alpaca/DB snapshot
// instead of refetching it on every click. The header's AutoRefresh keeps it fresh.
export const loadCompetitors = unstable_cache(fetchCompetitors, ["arena-competitors"], { revalidate: 10 });

const cachedEngineRuns = unstable_cache(
  async (traderId: string) =>
    db.select().from(engineRuns)
      .where(eq(engineRuns.traderId, traderId))
      .orderBy(desc(engineRuns.runAt))
      .limit(60),
  ["engine-runs"],
  { revalidate: 15 },
);

export async function loadEngineRuns(traderId: string): Promise<EngineRunRow[]> {
  // The cache serialises through JSON, so timestamps come back as strings.
  const rows = await cachedEngineRuns(traderId);
  return rows.map(r => ({ ...r, runAt: new Date(r.runAt) })) as EngineRunRow[];
}

// Per-strategy stats replay up to 500 Alpaca orders, so cache them longer.
export const loadStrategyStats = unstable_cache(
  async (trader: Trader): Promise<StrategyPerformance[]> => getStrategyPerformance(trader),
  ["strategy-stats"],
  { revalidate: 60 },
);

// Who is ahead, and by how much. Uses % return since the first snapshot when both sides
// have history (fair when starting balances differ), otherwise falls back to raw equity.
export function standings(competitors: Competitor[]) {
  const [a, b] = competitors;
  if (!a || !b) return null;
  const byReturn = a.returnPct !== null && b.returnPct !== null;
  const aLeads = byReturn ? a.returnPct! >= b.returnPct! : a.equity >= b.equity;
  const leader = aLeads ? a : b;
  const trailer = aLeads ? b : a;
  return {
    leader,
    trailer,
    byReturn,
    gapPct: byReturn ? Math.abs(a.returnPct! - b.returnPct!) : null,
    gapDollars: Math.abs(a.equity - b.equity),
  };
}
