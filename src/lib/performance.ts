// Risk-adjusted performance metrics — pure functions, no I/O.
//
// Two callers use this:
// - Account-level: daily equity_snapshots feed returnsFromEquity/sharpeRatio/etc directly.
// - Strategy-level: Alpaca has no notion of a strategy, so round trips are inferred by
//   matching each strategy's tagged entry order (strategy_trades) to the next opposite-side
//   fill on the same symbol (matchRoundTrips). That's an approximation, not a ledger.

export type OrderFill = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  filledQty: number;
  filledAvgPrice: number;
  filledAt: string; // ISO timestamp
  assetClass: string; // "us_equity" | "us_option"
};

export type RoundTrip = {
  symbol: string;
  entryOrderId: string;
  exitOrderId: string;
  entryAt: string;
  exitAt: string;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;       // dollars, includes the ×100 options multiplier
  returnPct: number; // pnl / capital committed at entry
};

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  const variance = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

// Period-over-period returns from a chronological series of equity/value levels.
export function returnsFromEquity(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    if (prev === 0) continue;
    out.push((values[i] - prev) / prev);
  }
  return out;
}

// Annualised Sharpe ratio. Returns null when there isn't enough data or the
// return series has zero variance (division by zero would be meaningless).
export function sharpeRatio(returns: number[], periodsPerYear: number, riskFreeRatePerPeriod = 0): number | null {
  if (returns.length < 2 || !Number.isFinite(periodsPerYear) || periodsPerYear <= 0) return null;
  const excess = returns.map(r => r - riskFreeRatePerPeriod);
  const sd = stdev(excess);
  if (!sd) return null;
  return (mean(excess) / sd) * Math.sqrt(periodsPerYear);
}

// Annualised Sortino ratio — like Sharpe but only penalises downside deviation.
// Returns null when there's no downside in the sample (ratio would be infinite/undefined).
export function sortinoRatio(returns: number[], periodsPerYear: number, riskFreeRatePerPeriod = 0): number | null {
  if (returns.length < 2 || !Number.isFinite(periodsPerYear) || periodsPerYear <= 0) return null;
  const excess = returns.map(r => r - riskFreeRatePerPeriod);
  const downsideSq = excess.reduce((s, r) => s + (r < 0 ? r * r : 0), 0);
  const downsideDev = Math.sqrt(downsideSq / excess.length);
  if (!downsideDev) return null;
  return (mean(excess) / downsideDev) * Math.sqrt(periodsPerYear);
}

// Worst peak-to-trough decline over a chronological series of levels, as a positive fraction (0..1).
export function maxDrawdownPct(values: number[]): number | null {
  if (values.length < 2) return null;
  let peak = values[0];
  let worst = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) worst = Math.max(worst, (peak - v) / peak);
  }
  return worst;
}

// Estimates how many round trips per year this strategy is actually producing,
// from the observed gap between its first and last closed trade. Used to annualise
// trade-level Sharpe/Sortino instead of assuming a fixed daily/hourly cadence that
// doesn't apply to irregularly-timed trades.
export function impliedTradesPerYear(sortedByExit: RoundTrip[]): number | null {
  if (sortedByExit.length < 2) return null;
  const first = new Date(sortedByExit[0].exitAt).getTime();
  const last = new Date(sortedByExit[sortedByExit.length - 1].exitAt).getTime();
  const days = (last - first) / 86_400_000;
  if (days <= 0) return null;
  return (sortedByExit.length / days) * 365;
}

// Below this many closed round trips, Sharpe/Sortino/drawdown on a strategy are just noise.
export const MIN_TRADES_FOR_STATS = 5;

const OPTIONS_MULTIPLIER = 100;

// Matches each tagged entry order to the next opposite-side fill on the same symbol
// (chronologically, first-come-first-served) to infer a closed round trip. `allFills`
// should span every order for the trader, not just this strategy's — exit orders are
// never tagged with a strategy today, so the only signal available is "same symbol,
// opposite side, happened after, not already claimed by an earlier entry."
export function matchRoundTrips(entryOrderIds: string[], allFills: OrderFill[]): RoundTrip[] {
  const byId = new Map(allFills.map(f => [f.id, f]));
  const bySymbol = new Map<string, OrderFill[]>();
  for (const f of allFills) {
    const list = bySymbol.get(f.symbol) ?? [];
    list.push(f);
    bySymbol.set(f.symbol, list);
  }
  for (const list of bySymbol.values()) list.sort((a, b) => a.filledAt.localeCompare(b.filledAt));

  const entries = entryOrderIds
    .map(id => byId.get(id))
    .filter((f): f is OrderFill => !!f)
    .sort((a, b) => a.filledAt.localeCompare(b.filledAt));

  const consumedExits = new Set<string>();
  const roundTrips: RoundTrip[] = [];

  for (const entry of entries) {
    const candidates = bySymbol.get(entry.symbol) ?? [];
    const exit = candidates.find(f =>
      f.id !== entry.id &&
      f.side !== entry.side &&
      f.filledAt > entry.filledAt &&
      !consumedExits.has(f.id),
    );
    if (!exit) continue; // still open, or no matching fill in the fetched window

    consumedExits.add(exit.id);
    const qty = Math.min(entry.filledQty, exit.filledQty);
    const multiplier = entry.assetClass === "us_option" ? OPTIONS_MULTIPLIER : 1;
    const direction = entry.side === "buy" ? 1 : -1;
    const pnl = direction * (exit.filledAvgPrice - entry.filledAvgPrice) * qty * multiplier;
    const capital = entry.filledAvgPrice * qty * multiplier;

    roundTrips.push({
      symbol: entry.symbol,
      entryOrderId: entry.id,
      exitOrderId: exit.id,
      entryAt: entry.filledAt,
      exitAt: exit.filledAt,
      entryPrice: entry.filledAvgPrice,
      exitPrice: exit.filledAvgPrice,
      qty,
      pnl,
      returnPct: capital !== 0 ? pnl / capital : 0,
    });
  }

  return roundTrips;
}
