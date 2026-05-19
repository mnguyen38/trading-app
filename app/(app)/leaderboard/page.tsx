import { getSession } from "@/src/lib/auth";
import { getAllTraders } from "@/src/lib/traders";
import { alpacaForTrader } from "@/src/lib/alpaca";
import { db } from "@/src/db/client";
import { equitySnapshots } from "@/src/db/schema";
import { asc } from "drizzle-orm";
import { money, signed } from "@/src/lib/format";
import { EquityChart } from "@/src/components/trading/EquityChart";

export const dynamic = "force-dynamic";

const PALETTE = ["#fb923c", "#38bdf8"]; // orange, sky
const MEDALS  = ["🥇", "🥈", "🥉"];

export default async function LeaderboardPage() {
  await getSession(); // enforce auth

  const allTraders = await getAllTraders();

  const [liveResults, snaps] = await Promise.all([
    Promise.all(
      allTraders.map(async trader => {
        try {
          const account = await alpacaForTrader(trader).getAccount();
          return { traderId: trader.id, equity: parseFloat(account.equity) };
        } catch {
          return { traderId: trader.id, equity: 0 };
        }
      })
    ),
    db.select().from(equitySnapshots).orderBy(asc(equitySnapshots.takenAt)),
  ]);

  const snapsByTrader = new Map<string, typeof snaps>();
  for (const s of snaps) {
    if (!snapsByTrader.has(s.traderId)) snapsByTrader.set(s.traderId, []);
    snapsByTrader.get(s.traderId)!.push(s);
  }

  const standings = allTraders
    .map((trader, i) => {
      const equity = liveResults.find(r => r.traderId === trader.id)?.equity ?? 0;
      const traderSnaps = snapsByTrader.get(trader.id) ?? [];
      const first = traderSnaps[0];
      const last  = traderSnaps[traderSnaps.length - 1];
      return {
        trader,
        color:      PALETTE[i % PALETTE.length],
        equity,
        todayPl:    last  ? equity - last.equity  : null,
        allTimePl:  first ? equity - first.equity : null,
        snapshots:  traderSnaps.map(s => ({
          date:   s.takenAt.toISOString().slice(0, 10),
          equity: s.equity,
        })),
      };
    })
    .sort((a, b) => b.equity - a.equity);

  const hasHistory = snaps.length > 0;

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="mb-6 text-2xl font-bold">Leaderboard</h1>

      {/* Live standings */}
      <div className="mb-8 flex flex-col gap-3">
        {standings.map((s, i) => (
          <div
            key={s.trader.id}
            className="flex items-center gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5"
          >
            <span className="w-8 shrink-0 text-center text-xl">{MEDALS[i] ?? i + 1}</span>
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-neutral-300">{s.trader.name}</div>
              <div className="font-mono text-2xl font-bold tabular-nums">{money(s.equity)}</div>
            </div>
            <div className="shrink-0 text-right text-xs">
              {s.todayPl !== null && (
                <div className={s.todayPl >= 0 ? "text-green-400" : "text-red-400"}>
                  <div className="text-neutral-600">Today</div>
                  <div className="font-mono">{signed(s.todayPl, n => money(n))}</div>
                </div>
              )}
              {s.allTimePl !== null && (
                <div className={`mt-1.5 ${s.allTimePl >= 0 ? "text-green-400" : "text-red-400"}`}>
                  <div className="text-neutral-600">All-time</div>
                  <div className="font-mono">{signed(s.allTimePl, n => money(n))}</div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Historical chart */}
      {hasHistory ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Portfolio history
          </h2>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <EquityChart
              series={standings.map(s => ({
                name:   s.trader.name,
                color:  s.color,
                points: s.snapshots,
              }))}
            />
            <div className="mt-3 flex gap-5">
              {standings.map(s => (
                <div key={s.trader.id} className="flex items-center gap-1.5 text-xs text-neutral-500">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.trader.name}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <p className="text-center text-sm text-neutral-600">
          Portfolio history will appear after the first market close.
        </p>
      )}
    </main>
  );
}
