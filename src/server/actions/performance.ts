"use server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/src/db/client";
import { strategyTrades, equitySnapshots } from "@/src/db/schema";
import { alpacaForTrader } from "@/src/lib/alpaca";
import type { Trader } from "@/src/lib/traders";
import { strategiesForType } from "@/src/lib/strategies";
import {
  returnsFromEquity, sharpeRatio, sortinoRatio, maxDrawdownPct,
  impliedTradesPerYear, matchRoundTrips, MIN_TRADES_FOR_STATS,
  type OrderFill, type RoundTrip,
} from "@/src/lib/performance";

// equity_snapshots are taken once per trading day at market close (see app/api/snapshot/route.ts
// and its vercel.json cron entry) — daily-return convention, so annualise with √252.
const DAILY_PERIODS_PER_YEAR = 252;

export type AccountPerformance = {
  points: { date: string; equity: number }[];
  sharpe: number | null;
  sortino: number | null;
  maxDrawdownPct: number | null;
  totalReturnPct: number | null;
};

// "Complete model" — the whole account's combined performance, from stored daily equity snapshots.
export async function getAccountPerformance(traderId: string): Promise<AccountPerformance> {
  const rows = await db.select().from(equitySnapshots)
    .where(eq(equitySnapshots.traderId, traderId))
    .orderBy(asc(equitySnapshots.takenAt));

  const points = rows.map(r => ({ date: r.takenAt.toISOString().slice(0, 10), equity: r.equity }));
  const equityValues = points.map(p => p.equity);
  const returns = returnsFromEquity(equityValues);

  return {
    points,
    sharpe: sharpeRatio(returns, DAILY_PERIODS_PER_YEAR),
    sortino: sortinoRatio(returns, DAILY_PERIODS_PER_YEAR),
    maxDrawdownPct: maxDrawdownPct(equityValues),
    totalReturnPct: equityValues.length >= 2 && equityValues[0] !== 0
      ? (equityValues[equityValues.length - 1] - equityValues[0]) / equityValues[0]
      : null,
  };
}

export type StrategyPerformance = {
  slug: string;
  name: string;
  allocationPct: number;
  tradeCount: number;
  totalRealizedPnl: number;
  winRate: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdownPct: number | null;
  curve: { date: string; equity: number }[];
  hasEnoughTrades: boolean;
};

// "Individual models" — per-strategy performance. Alpaca has no notion of a strategy, so realized
// P&L is derived by matching each strategy's tagged entry orders (strategy_trades) against the
// trader's full closed-order history from Alpaca. This is an approximation: it only covers fully
// closed round trips, and exit orders can't be traced back to a strategy today, so the match is
// "next opposite-side fill on the same symbol" rather than a stored link.
export async function getStrategyPerformance(trader: Trader): Promise<StrategyPerformance[]> {
  const strategies = strategiesForType(trader.type);
  const alpaca = alpacaForTrader(trader);

  const [tags, closedOrders, account] = await Promise.all([
    db.select().from(strategyTrades).where(eq(strategyTrades.traderId, trader.id)),
    alpaca.getOrders("closed", 500),
    alpaca.getAccount(),
  ]);

  const equity = parseFloat(account.equity);

  const fills: OrderFill[] = closedOrders
    .filter(o => o.status === "filled" && o.filled_avg_price && o.filled_at)
    .map(o => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      filledQty: parseFloat(o.filled_qty),
      filledAvgPrice: parseFloat(o.filled_avg_price!),
      filledAt: o.filled_at!,
      assetClass: o.asset_class,
    }));

  const entryOrderIdsBySlug = new Map<string, string[]>();
  for (const t of tags) {
    const list = entryOrderIdsBySlug.get(t.strategySlug) ?? [];
    list.push(t.orderId);
    entryOrderIdsBySlug.set(t.strategySlug, list);
  }

  return strategies.map(strategy => {
    const entryOrderIds = entryOrderIdsBySlug.get(strategy.slug) ?? [];
    const trades = matchRoundTrips(entryOrderIds, fills);
    const sortedByExit = [...trades].sort((a, b) => a.exitAt.localeCompare(b.exitAt));

    // Synthetic equity curve: allocated capital + cumulative realized P&L over time.
    // There's no stored per-strategy equity history, so this approximates one for charting
    // and for max-drawdown — it is not a real historical balance.
    const baseline = equity * (strategy.allocationPct / 100);
    let running = baseline;
    const curve = sortedByExit.map(t => {
      running += t.pnl;
      return { date: t.exitAt.slice(0, 10), equity: running };
    });

    const hasEnoughTrades = trades.length >= MIN_TRADES_FOR_STATS;
    const tradesPerYear = impliedTradesPerYear(sortedByExit);
    const tradeReturns = trades.map(t => t.returnPct);
    const wins = trades.filter(t => t.pnl > 0).length;

    return {
      slug: strategy.slug,
      name: strategy.name,
      allocationPct: strategy.allocationPct,
      tradeCount: trades.length,
      totalRealizedPnl: trades.reduce((s, t) => s + t.pnl, 0),
      winRate: trades.length > 0 ? wins / trades.length : null,
      sharpe: hasEnoughTrades && tradesPerYear ? sharpeRatio(tradeReturns, tradesPerYear) : null,
      sortino: hasEnoughTrades && tradesPerYear ? sortinoRatio(tradeReturns, tradesPerYear) : null,
      maxDrawdownPct: hasEnoughTrades ? maxDrawdownPct([baseline, ...curve.map(c => c.equity)]) : null,
      curve,
      hasEnoughTrades,
    };
  });
}
