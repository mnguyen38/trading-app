import { Suspense } from "react";
import { loadCompetitors, loadStrategyStats, SIDE_LABEL, type Competitor } from "@/src/lib/arena";
import type { Trader } from "@/src/lib/traders";
import { MIN_TRADES_FOR_STATS } from "@/src/lib/performance";
import { EquityChart } from "@/src/components/trading/EquityChart";
import { money, pct, signed } from "@/src/lib/format";

export const dynamic = "force-dynamic";

type Metric = {
  label: string;
  value: (c: Competitor) => number | null;
  format: (v: number) => string;
  higherIsBetter: boolean;
};

const METRICS: Metric[] = [
  { label: "Total return", value: c => c.perf.totalReturnPct, format: v => signed(v, n => pct(n)), higherIsBetter: true },
  { label: "Sharpe ratio", value: c => c.perf.sharpe, format: v => v.toFixed(2), higherIsBetter: true },
  { label: "Sortino ratio", value: c => c.perf.sortino, format: v => v.toFixed(2), higherIsBetter: true },
  { label: "Max drawdown", value: c => c.perf.maxDrawdownPct, format: v => pct(-v, 1), higherIsBetter: false },
];

export default async function PerformancePage() {
  const competitors = await loadCompetitors();
  return (
    <div>
      <div className="border-b border-neutral-800 px-8 py-6">
        <h1 className="text-xl font-bold">Performance</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">
          Sharpe and Sortino measure return per unit of risk (Sortino only penalises downside);
          max drawdown is the worst peak-to-trough fall. Whole-account numbers come from daily
          equity snapshots; per-strategy numbers are inferred from Alpaca fills.
        </p>
      </div>

      {/* Tale of the tape */}
      {competitors.length === 2 && (
        <section className="border-b border-neutral-800 px-8 py-6">
          <div className="mx-auto max-w-3xl">
            <div className="mb-2 grid grid-cols-[1fr_1fr_1fr] gap-4 text-center text-xs font-bold uppercase tracking-[0.15em]">
              <span style={{ color: competitors[0].color }}>{competitors[0].trader.name}</span>
              <span className="text-neutral-600">Tale of the tape</span>
              <span style={{ color: competitors[1].color }}>{competitors[1].trader.name}</span>
            </div>
            <div className="divide-y divide-neutral-800/70 border-y border-neutral-800/70">
              {METRICS.map(m => {
                const [a, b] = competitors.map(m.value);
                const winner =
                  a === null || b === null || a === b ? null : (a > b) === m.higherIsBetter ? 0 : 1;
                return (
                  <div key={m.label} className="grid grid-cols-[1fr_1fr_1fr] items-center gap-4 py-3.5 text-center">
                    {[a, b].map((v, i) => (
                      <span
                        key={i}
                        className={`font-mono text-xl font-semibold tabular-nums ${i === 0 ? "" : "order-3"} ${
                          winner === i ? "" : "text-neutral-500"
                        }`}
                        style={winner === i ? { color: competitors[i].color } : undefined}
                      >
                        {v === null ? "—" : m.format(v)}
                      </span>
                    ))}
                    <span className="order-2 text-xs uppercase tracking-wider text-neutral-500">{m.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-neutral-800">
        {competitors.map(c => (
          <section key={c.trader.id} className="min-w-0 px-8 py-7" style={{ boxShadow: `inset 0 3px 0 ${c.color}` }}>
            <div className="mb-5 flex items-center gap-3">
              <h2 className="text-lg font-bold" style={{ color: c.color }}>{c.trader.name}</h2>
              <span className="text-xs text-neutral-500">{SIDE_LABEL[c.trader.type]}</span>
            </div>

            {c.snapshots.length >= 2 ? (
              <div className="mb-8">
                <EquityChart width={800} height={220} series={[{ name: c.trader.name, color: c.color, points: c.snapshots }]} />
              </div>
            ) : (
              <p className="mb-8 border-y border-dashed border-neutral-800 py-8 text-center text-xs text-neutral-600">
                Not enough daily snapshots yet — check back after a few more trading days.
              </p>
            )}

            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-neutral-500">
              By strategy
            </h3>
            <Suspense fallback={<StrategySkeleton />}>
              <StrategyStats trader={c.trader} />
            </Suspense>
          </section>
        ))}
      </div>

      <p className="border-t border-neutral-800 px-8 py-5 text-[11px] text-neutral-600">
        Strategy P&amp;L matches each tagged entry order to the next opposite-side fill on the same
        symbol in Alpaca&apos;s order history — an approximation, not a stored ledger. Only fully
        closed round trips count; open positions are excluded.
      </p>
    </div>
  );
}

async function StrategyStats({ trader }: { trader: Trader }) {
  const stats = await loadStrategyStats(trader).catch(() => null);
  return (
  <>
  {stats === null ? (
    <p className="text-xs text-red-400">Couldn&apos;t load fill history from Alpaca.</p>
  ) : (
    <div className="divide-y divide-neutral-800/70 border-y border-neutral-800/70">
      {stats.map(s => (
        <div key={s.slug} className="py-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-semibold">{s.name}</span>
            <span
              className={`font-mono text-sm tabular-nums ${
                s.tradeCount === 0 ? "text-neutral-600" : s.totalRealizedPnl >= 0 ? "text-green-400" : "text-red-400"
              }`}
            >
              {s.tradeCount > 0 ? signed(s.totalRealizedPnl, v => money(v)) : "—"}
            </span>
          </div>
          {s.hasEnoughTrades ? (
            <div className="flex gap-8 text-xs">
              <Mini label="Sharpe" value={s.sharpe === null ? "—" : s.sharpe.toFixed(2)} />
              <Mini label="Sortino" value={s.sortino === null ? "—" : s.sortino.toFixed(2)} />
              <Mini label="Max DD" value={s.maxDrawdownPct === null ? "—" : pct(-s.maxDrawdownPct, 1)} />
              <Mini label="Win rate" value={s.winRate === null ? "—" : pct(s.winRate, 0)} />
              <Mini label="Trades" value={String(s.tradeCount)} />
            </div>
          ) : (
            <p className="text-xs text-neutral-600">
              {s.tradeCount} closed trade{s.tradeCount === 1 ? "" : "s"} — needs {MIN_TRADES_FOR_STATS} for risk-adjusted stats.
            </p>
          )}
        </div>
      ))}
    </div>
  )}
  </>
  );
}

function StrategySkeleton() {
  return (
    <div className="animate-pulse divide-y divide-neutral-800/70 border-y border-neutral-800/70">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="py-4">
          <div className="mb-3 flex justify-between">
            <div className="h-4 w-36 rounded bg-neutral-800" />
            <div className="h-4 w-16 rounded bg-neutral-800" />
          </div>
          <div className="h-8 w-2/3 rounded bg-neutral-900" />
        </div>
      ))}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</div>
      <div className="mt-0.5 font-mono font-semibold tabular-nums text-neutral-200">{value}</div>
    </div>
  );
}
