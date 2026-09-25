import { Suspense } from "react";
import { loadCompetitors, loadEngineRuns, SIDE_LABEL } from "@/src/lib/arena";
import { strategiesForType, cashBufferPct, bufferConfig } from "@/src/lib/strategies";
import { StrategyCard } from "@/src/components/strategies/StrategyCard";
import { EngineLog } from "@/src/components/strategies/EngineLog";
import { money } from "@/src/lib/format";

export const dynamic = "force-dynamic";

export default async function StrategiesPage() {
  const competitors = await loadCompetitors();

  return (
    <div>
      <div className="border-b border-neutral-800 px-8 py-6">
        <h1 className="text-xl font-bold">Strategies</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">
          How each side is implemented: the rules the engine trades, how capital is split, and what
          it did on each run. Nothing here is manual — the cron-driven engine places every order.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-neutral-800">
        {competitors.map(c => {
          const strategies = strategiesForType(c.trader.type);
          const buffer = bufferConfig(c.trader.type);
          const totalPct = strategies.reduce((s, st) => s + st.allocationPct, 0) + cashBufferPct(c.trader.type);
          return (
            <section key={c.trader.id} className="min-w-0 px-8 py-7" style={{ boxShadow: `inset 0 3px 0 ${c.color}` }}>
              <div className="mb-6 flex items-center gap-3">
                <h2 className="text-lg font-bold" style={{ color: c.color }}>{c.trader.name}</h2>
                <span className="text-xs text-neutral-500">{SIDE_LABEL[c.trader.type]}</span>
                <span className="ml-auto font-mono text-sm font-semibold tabular-nums">{money(c.equity, 0)}</span>
              </div>

              {/* Capital allocation */}
              <div className="mb-6 border-y border-neutral-800 py-4">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-neutral-500">
                  Capital allocation
                </div>
                <div className="space-y-2">
                  {strategies.map(st => (
                    <Bar key={st.slug} label={st.name} pct={st.allocationPct} dollars={c.equity * st.allocationPct / 100} color={c.color} />
                  ))}
                  <Bar label="Hard cash reserve" pct={buffer.hardCashPct} dollars={c.equity * buffer.hardCashPct / 100} color="#404040" muted />
                  {buffer.investedPct > 0 && (
                    <Bar label={buffer.investedTickerName} pct={buffer.investedPct} dollars={c.equity * buffer.investedPct / 100} color="#0c4a6e" muted />
                  )}
                </div>
                <div className="mt-3 text-[10px] text-neutral-600">
                  Scales with live equity · {totalPct}% allocated
                </div>
              </div>

              <div className="flex flex-col gap-4">
                {strategies.map(strategy => (
                  <StrategyCard key={strategy.slug} strategy={strategy} activePl={null} accountEquity={c.equity} />
                ))}
              </div>

              <Suspense fallback={<div className="mt-8 h-40 animate-pulse rounded-xl bg-neutral-900" />}>
                <EngineRuns traderId={c.trader.id} />
              </Suspense>
            </section>
          );
        })}
      </div>
    </div>
  );
}

async function EngineRuns({ traderId }: { traderId: string }) {
  return <EngineLog runs={await loadEngineRuns(traderId)} />;
}

function Bar({
  label, pct, dollars, color, muted,
}: {
  label: string; pct: number; dollars: number; color: string; muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-48 shrink-0 truncate text-xs ${muted ? "text-neutral-600" : "text-neutral-300"}`}>{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-neutral-400">{money(dollars, 0)}</span>
      <span className="w-9 shrink-0 text-right text-xs text-neutral-600">{pct}%</span>
    </div>
  );
}
