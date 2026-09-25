import { loadCompetitors, standings, SIDE_LABEL, type Competitor } from "@/src/lib/arena";
import { EquityChart } from "@/src/components/trading/EquityChart";
import { TraderPanel } from "@/src/components/arena/TraderPanel";
import { money, pct, signed } from "@/src/lib/format";

export const dynamic = "force-dynamic";

export default async function ArenaPage() {
  const competitors = await loadCompetitors();
  const table = standings(competitors);
  const hasHistory = competitors.some(c => c.snapshots.length >= 2);

  if (competitors.length === 0) {
    return (
      <p className="px-8 py-24 text-center text-sm text-neutral-500">
        No traders found in the database. Run the seed script to create the two competitors.
      </p>
    );
  }

  return (
    <div>
      {/* Gap strip */}
      {table && (
        <div className="border-b border-neutral-800 bg-neutral-900/60 px-8 py-2.5 text-center text-xs uppercase tracking-[0.18em] text-neutral-400">
          <span className="font-bold" style={{ color: table.leader.color }}>{table.leader.trader.name}</span>
          {" leads by "}
          <span className="font-mono font-semibold text-neutral-100">
            {table.gapPct !== null ? `${(table.gapPct * 100).toFixed(2)} pts` : money(table.gapDollars)}
          </span>
          {table.gapPct !== null && (
            <span className="text-neutral-600"> · {money(table.gapDollars)} equity gap</span>
          )}
        </div>
      )}

      {/* Scoreboard */}
      <section className="relative grid lg:grid-cols-2 lg:divide-x lg:divide-neutral-800">
        {competitors.map(c => (
          <Score key={c.trader.id} c={c} leading={table?.leader.trader.id === c.trader.id} />
        ))}
        {competitors.length === 2 && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 hidden h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950 text-xs font-black tracking-wider text-neutral-400 lg:flex">
            VS
          </div>
        )}
      </section>

      {/* History */}
      <section className="border-y border-neutral-800 px-8 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-neutral-500">
            Portfolio history
          </h2>
          <div className="flex gap-5">
            {competitors.map(c => (
              <span key={c.trader.id} className="flex items-center gap-1.5 text-xs text-neutral-400">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                {c.trader.name}
              </span>
            ))}
          </div>
        </div>
        {hasHistory ? (
          <EquityChart
            width={1600}
            height={340}
            series={competitors.map(c => ({ name: c.trader.name, color: c.color, points: c.snapshots }))}
          />
        ) : (
          <p className="py-16 text-center text-sm text-neutral-600">
            History fills in after the first market close — snapshots are taken once per trading day.
          </p>
        )}
      </section>

      {/* Live panels */}
      <section className="grid lg:grid-cols-2 lg:divide-x lg:divide-neutral-800">
        {competitors.map(c => (
          <TraderPanel key={c.trader.id} c={c} />
        ))}
      </section>
    </div>
  );
}

function Score({ c, leading }: { c: Competitor; leading: boolean }) {
  const { perf } = c;
  return (
    <div className="px-8 py-9" style={{ boxShadow: `inset 0 3px 0 ${c.color}` }}>
      <div className="mb-1 flex items-center gap-3">
        <span className="text-sm font-semibold uppercase tracking-[0.15em]" style={{ color: c.color }}>
          {c.trader.name}
        </span>
        <span className="text-xs text-neutral-600">{SIDE_LABEL[c.trader.type]}</span>
        {leading && (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-neutral-900">
            Leading
          </span>
        )}
      </div>

      <div className="font-mono text-6xl font-bold tabular-nums tracking-tight">{money(c.equity, 0)}</div>

      <div className="mt-5 grid grid-cols-3 gap-6">
        <Figure label="Today" value={c.todayPl} />
        <Figure label="All-time" value={c.allTimePl} />
        <div>
          <div className="text-[10px] uppercase tracking-wider text-neutral-600">Return</div>
          <div
            className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${
              c.returnPct === null ? "text-neutral-600" : c.returnPct >= 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {c.returnPct === null ? "—" : signed(c.returnPct, n => pct(n))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex gap-8 border-t border-neutral-800 pt-4">
        <Stat label="Sharpe" value={perf.sharpe === null ? "—" : perf.sharpe.toFixed(2)} />
        <Stat label="Sortino" value={perf.sortino === null ? "—" : perf.sortino.toFixed(2)} />
        <Stat label="Max drawdown" value={perf.maxDrawdownPct === null ? "—" : pct(-perf.maxDrawdownPct, 1)} />
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</div>
      <div
        className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${
          value === null ? "text-neutral-600" : value >= 0 ? "text-green-400" : "text-red-400"
        }`}
      >
        {value === null ? "—" : signed(value, n => money(n, 0))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-neutral-200">{value}</div>
    </div>
  );
}
