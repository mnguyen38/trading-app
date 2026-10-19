import { loadCompetitors, standings, type Competitor } from "@/src/lib/arena";
import { HistoryChart } from "@/src/components/arena/HistoryChart";
import { TraderPanel } from "@/src/components/arena/TraderPanel";
import { money, pct, signed } from "@/src/lib/format";

export const dynamic = "force-dynamic";

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function ArenaPage() {
  const competitors = await loadCompetitors();
  const table = standings(competitors);
  const hasHistory = competitors.some(c => c.snapshots.length >= 2);

  if (competitors.length === 0) {
    return (
      <p className="px-6 py-24 text-center text-muted">
        No traders found in the database. Run the seed script to create the two competitors.
      </p>
    );
  }

  const first = competitors.find(c => c.snapshots.length > 0)?.snapshots[0]?.date;
  const days = Math.max(...competitors.map(c => c.snapshots.length));
  const gapText = !table
    ? null
    : table.gapPct !== null
      ? `${(table.gapPct * 100).toFixed(1)} points`
      : money(table.gapDollars, 0);

  return (
    <div>
      {/* Hero */}
      <section className="flex flex-col gap-10 border-b border-line px-6 py-14 lg:flex-row lg:items-end lg:justify-between lg:px-14">
        <div className="max-w-205">
          <div className="text-[13px] font-medium uppercase tracking-[0.18em] text-muted">
            {days > 0 ? `Day ${days} of the competition` : "Live"}
          </div>
          <h1 className="mt-4 font-serif text-6xl font-medium leading-[1.02] tracking-tight lg:text-[76px]">
            {table && gapText ? (
              <>
                <span style={{ color: table.leader.color }}>{table.leader.trader.name}</span> is ahead by {gapText}
              </>
            ) : (
              "The competition"
            )}
          </h1>
          <p className="mt-5 max-w-160 text-xl leading-relaxed text-muted">
            Options against stocks and ETFs, one Alpaca paper account each
            {first ? `, since ${shortDate(first)}` : ""}.{" "}
            {competitors.map((c, i) => (
              <span key={c.trader.id}>
                {i > 0 && "; "}
                {c.trader.name} is {c.returnPct === null ? "—" : `${signed(c.returnPct, n => pct(n))}`}
              </span>
            ))}
            .
          </p>
        </div>

        <div className="flex gap-14 pb-1.5">
          {competitors.map(c => (
            <div key={c.trader.id}>
              <div className="text-[13px] font-medium uppercase tracking-[0.14em] text-muted">{c.trader.name}</div>
              <div className="font-serif text-6xl font-medium leading-[1.1] tabular-nums" style={{ color: c.color }}>
                {money(c.equity, 0)}
              </div>
              <div
                className={`text-[15px] font-semibold ${
                  c.todayPl === null ? "text-muted" : c.todayPl >= 0 ? "text-up" : "text-down"
                }`}
              >
                {c.todayPl === null ? "—" : `${c.todayPl >= 0 ? "▲" : "▼"} ${signed(c.todayPl, n => money(n, 0))} today`}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Tale of the tape */}
      {competitors.length === 2 && (
        <section className="border-b border-line bg-card px-6 pb-2 pt-9 lg:px-14">
          <div className="mx-auto max-w-312.5">
            <div className="pb-3.5 text-center text-[13px] font-medium uppercase tracking-[0.16em] text-muted">
              Tale of the tape
            </div>
            <TapeRow label="Return" competitors={competitors} value={c => c.returnPct} higherIsBetter format={v => signed(v, n => pct(n))} />
            <TapeRow label="Sharpe" competitors={competitors} value={c => c.perf.sharpe} higherIsBetter format={v => v.toFixed(2)} />
            <TapeRow label="Sortino" competitors={competitors} value={c => c.perf.sortino} higherIsBetter format={v => v.toFixed(2)} />
            <TapeRow label="Max drawdown" competitors={competitors} value={c => c.perf.maxDrawdownPct} higherIsBetter={false} format={v => pct(-v, 1)} />
          </div>
        </section>
      )}

      {/* History */}
      <section className="border-b border-line px-6 pb-8 pt-9 lg:px-14">
        <h2 className="mb-5 font-serif text-3xl font-medium">Portfolio history</h2>
        {hasHistory ? (
          <HistoryChart
            series={competitors.map(c => ({ name: c.trader.name, color: c.color, points: c.snapshots }))}
          />
        ) : (
          <p className="py-16 text-center text-muted">
            History fills in after the first market close — snapshots are taken once per trading day.
          </p>
        )}
      </section>

      {/* Traders */}
      <section className="grid gap-6 px-6 py-9 lg:grid-cols-2 lg:px-14">
        {competitors.map(c => (
          <TraderPanel key={c.trader.id} c={c} />
        ))}
      </section>
    </div>
  );
}

// One diverging-bar row: left trader's value and bar, metric label, right trader's bar and value.
// The better side is drawn in its own colour, the other in ink.
function TapeRow({
  label,
  competitors,
  value,
  higherIsBetter,
  format,
}: {
  label: string;
  competitors: Competitor[];
  value: (c: Competitor) => number | null;
  higherIsBetter: boolean;
  format: (v: number) => string;
}) {
  const [a, b] = competitors.map(value);
  const winner = a === null || b === null || a === b ? null : (a > b) === higherIsBetter ? 0 : 1;
  const mag = Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0)) || 1;
  const pctWidth = (v: number | null) => (v === null ? 0 : Math.max(3, Math.round((Math.abs(v) / mag) * 100)));
  const colorFor = (i: number) => (winner === i ? competitors[i].color : "#3a3833");

  return (
    <div className="flex h-16 items-center border-b border-line last:border-b-0">
      <div className="w-32 pr-5 text-right font-serif text-3xl font-medium tabular-nums sm:w-44" style={{ color: colorFor(0) }}>
        {a === null ? "—" : format(a)}
      </div>
      <div className="flex flex-1 justify-end">
        <div className="h-3.5 rounded-l-full" style={{ width: `${pctWidth(a)}%`, backgroundColor: colorFor(0) }} />
      </div>
      <div className="w-32 shrink-0 text-center text-[13px] uppercase tracking-[0.14em] text-muted sm:w-56">{label}</div>
      <div className="flex-1">
        <div className="h-3.5 rounded-r-full" style={{ width: `${pctWidth(b)}%`, backgroundColor: colorFor(1) }} />
      </div>
      <div className="w-32 pl-5 font-serif text-3xl font-medium tabular-nums sm:w-44" style={{ color: colorFor(1) }}>
        {b === null ? "—" : format(b)}
      </div>
    </div>
  );
}
