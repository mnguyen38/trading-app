"use client";
import Link from "next/link";
import { useLiveAccount, type LiveData } from "@/src/hooks/useLiveAccount";
import { usePriceStream } from "@/src/hooks/usePriceStream";
import { PortfolioPie } from "./PortfolioPie";
import { money, signed, pct, num } from "@/src/lib/format";
import type { Position, Order } from "@/src/lib/alpaca";
import { getStrategy } from "@/src/lib/strategies";

type StrategyTradeRow = {
  strategySlug: string;
  symbol: string;
};

type Props = {
  traderName: string;
  accountNumber: string;
  accountStatus: string;
  initialData: LiveData;
  strategyTrades?: StrategyTradeRow[];
};

export function LiveDashboard({ traderName, accountNumber, accountStatus, initialData, strategyTrades = [] }: Props) {
  const { account, positions, openOrders, stale } = useLiveAccount(initialData);

  const symbols = positions.map(p => p.symbol);
  const streamPrices = usePriceStream(symbols);

  const polledEquity = parseFloat(account.equity);
  const equityDelta = positions.reduce((sum, p) => {
    const live = streamPrices[p.symbol];
    if (live === undefined) return sum;
    return sum + (live - parseFloat(p.current_price)) * parseFloat(p.qty);
  }, 0);
  const equity = polledEquity + equityDelta;
  const cash = parseFloat(account.cash);

  const dayPl = positions.reduce((sum, p) => {
    const live = streamPrices[p.symbol];
    if (live !== undefined) {
      return sum + (live - parseFloat(p.avg_entry_price)) * parseFloat(p.qty);
    }
    return sum + parseFloat(p.unrealized_pl);
  }, 0);
  const dayPlPct = equity > 0 ? dayPl / equity : 0;

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">{traderName}&rsquo;s Portfolio</h1>
      </header>

      <section className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs uppercase tracking-wide text-neutral-500">Portfolio value</span>
            {!stale && (
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500 opacity-60" />
            )}
          </div>
          {stale && <span className="text-xs text-neutral-600">Reconnecting…</span>}
        </div>
        <div className="mt-1 font-mono text-4xl font-bold tabular-nums">{money(equity)}</div>
        <div className={`mt-2 text-sm ${dayPl >= 0 ? "text-green-400" : "text-red-400"}`}>
          {signed(dayPl, n => money(n))} ({signed(dayPlPct, n => pct(n))}) today
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-neutral-500">Cash</div>
            <div className="font-mono tabular-nums">{money(cash)}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Buying power</div>
            <div className="font-mono tabular-nums">{money(account.buying_power)}</div>
          </div>
        </div>
      </section>

      {positions.length > 0 && (
        <PortfolioPie positions={positions} equity={equity} cash={cash} />
      )}

      <PositionsSection positions={positions} streamPrices={streamPrices} />
      <OpenOrdersSection orders={openOrders} />
      <StrategyPerformanceSection
        strategyTrades={strategyTrades}
        positions={positions}
        streamPrices={streamPrices}
      />

      <footer className="mt-10 text-center text-xs text-neutral-600">
        Account {accountNumber} · {accountStatus}
      </footer>
    </div>
  );
}

function PositionsSection({
  positions,
  streamPrices,
}: {
  positions: Position[];
  streamPrices: Record<string, number>;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Positions ({positions.length})
      </h2>
      {positions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-800 p-6 text-center text-sm text-neutral-500">
          No open positions.{" "}
          <Link href="/trade" className="text-neutral-300 underline underline-offset-2">
            Place your first trade →
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900">
          {positions.map(p => {
            const live = streamPrices[p.symbol];
            const qty = parseFloat(p.qty);
            const avg = parseFloat(p.avg_entry_price);
            const price = live ?? parseFloat(p.current_price);
            const marketValue = live !== undefined ? price * qty : parseFloat(p.market_value);
            const pl = live !== undefined ? (price - avg) * qty : parseFloat(p.unrealized_pl);
            const plpc = avg > 0 ? (price - avg) / avg : parseFloat(p.unrealized_plpc);
            return (
              <Link
                key={p.symbol}
                href={`/positions/${p.symbol}`}
                className="flex items-baseline justify-between p-4 transition hover:bg-neutral-800/60"
              >
                <div>
                  <div className="flex items-center gap-1.5 font-semibold">
                    {p.symbol}
                    {live !== undefined && (
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500 opacity-70" />
                    )}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {num(p.qty)} shares · avg {money(avg)} · now {money(price)}
                  </div>
                </div>
                <div className="text-right font-mono tabular-nums">
                  <div>{money(marketValue)}</div>
                  <div className={`text-xs ${pl >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {signed(pl, n => money(n))} ({signed(plpc, n => pct(n))})
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function OpenOrdersSection({ orders }: { orders: Order[] }) {
  if (orders.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Open orders ({orders.length})
      </h2>
      <div className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900">
        {orders.map(o => (
          <div key={o.id} className="flex items-baseline justify-between p-4 text-sm">
            <div>
              <div>
                <span className={o.side === "buy" ? "text-green-400" : "text-red-400"}>
                  {o.side.toUpperCase()}
                </span>{" "}
                <span className="font-semibold">{o.symbol}</span>{" "}
                <span className="text-xs text-neutral-500">{o.type}</span>
              </div>
              <div className="text-xs text-neutral-500">
                {o.qty ?? "—"} shares
                {o.limit_price ? ` · limit ${money(o.limit_price)}` : ""}
                {o.stop_price ? ` · stop ${money(o.stop_price)}` : ""}
              </div>
            </div>
            <div className="text-right text-xs text-neutral-400">{o.status}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StrategyPerformanceSection({
  strategyTrades,
  positions,
  streamPrices,
}: {
  strategyTrades: StrategyTradeRow[];
  positions: Position[];
  streamPrices: Record<string, number>;
}) {
  if (strategyTrades.length === 0) return null;

  // Build symbol → P&L map from live positions
  const plBySymbol = new Map<string, number>();
  for (const p of positions) {
    const live = streamPrices[p.symbol];
    const qty = parseFloat(p.qty);
    const avg = parseFloat(p.avg_entry_price);
    const pl = live !== undefined
      ? (live - avg) * qty
      : parseFloat(p.unrealized_pl);
    plBySymbol.set(p.symbol, pl);
  }

  // Group tagged symbols by strategy, sum P&L for symbols that have open positions
  const bySlug = new Map<string, { symbols: Set<string>; totalPl: number; hasPositions: boolean }>();
  for (const tag of strategyTrades) {
    if (!bySlug.has(tag.strategySlug)) {
      bySlug.set(tag.strategySlug, { symbols: new Set(), totalPl: 0, hasPositions: false });
    }
    const entry = bySlug.get(tag.strategySlug)!;
    entry.symbols.add(tag.symbol);
    const pl = plBySymbol.get(tag.symbol);
    if (pl !== undefined) {
      entry.totalPl += pl;
      entry.hasPositions = true;
    }
  }

  // Only show strategies that have at least one tagged trade
  const entries = [...bySlug.entries()];

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Strategy performance
        </h2>
        <Link href="/strategies" className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-300">
          View all →
        </Link>
      </div>
      <div className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900">
        {entries.map(([slug, data]) => {
          const strategy = getStrategy(slug);
          return (
            <Link
              key={slug}
              href="/strategies"
              className="flex items-center justify-between p-4 transition hover:bg-neutral-800/60"
            >
              <div>
                <div className="text-sm font-semibold">{strategy?.name ?? slug}</div>
                <div className="text-xs text-neutral-500">
                  {data.symbols.size} symbol{data.symbols.size !== 1 ? "s" : ""} tagged
                  {!data.hasPositions && " · no open positions"}
                </div>
              </div>
              {data.hasPositions && (
                <div className={`font-mono text-sm tabular-nums ${data.totalPl >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {signed(data.totalPl, n => money(n))}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
