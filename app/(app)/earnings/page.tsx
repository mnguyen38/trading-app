import { getUpcomingEarnings, type EarningsEvent } from "@/src/lib/engine/earningsFetcher";
import { getSession } from "@/src/lib/auth";
import { getTraderById } from "@/src/lib/traders";

export const dynamic = "force-dynamic";

function timingLabel(timing: EarningsEvent["timing"]) {
  if (timing === "amc") return "After close";
  if (timing === "bmo") return "Before open";
  return "Time TBD";
}

function timingBadgeClass(timing: EarningsEvent["timing"]) {
  if (timing === "amc") return "text-purple-400 bg-purple-900/30";
  if (timing === "bmo") return "text-blue-400 bg-blue-900/30";
  return "text-neutral-500 bg-neutral-800";
}

function dayLabel(dateStr: string, daysUntil: number) {
  if (daysUntil === 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export default async function EarningsPage() {
  const traderId = await getSession();
  const trader = await getTraderById(traderId);
  const isMicro = trader?.type === "micro";

  const events = await getUpcomingEarnings(14).catch(() => [] as EarningsEvent[]);

  // Group by date
  const byDate = new Map<string, EarningsEvent[]>();
  for (const ev of events) {
    if (!byDate.has(ev.date)) byDate.set(ev.date, []);
    byDate.get(ev.date)!.push(ev);
  }
  const days = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Earnings</h1>
        <span className="text-xs text-neutral-600">next 14 days</span>
      </div>
      <p className="mb-6 text-sm text-neutral-500">
        Upcoming reports for stocks in your watchlist.
        {isMicro && " Rows highlighted in amber fall in the IV crush entry window (5–7 days out)."}
      </p>

      {days.length === 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-10 text-center text-sm text-neutral-600">
          No earnings in the next 14 days for your watchlist.
        </div>
      )}

      <div className="space-y-5">
        {days.map(([date, evs]) => {
          const daysUntil = evs[0].daysUntil;
          return (
            <section key={date}>
              {/* Day header */}
              <div className="mb-2 flex items-baseline gap-2">
                <span className={`text-sm font-semibold ${daysUntil === 0 ? "text-orange-400" : "text-neutral-200"}`}>
                  {dayLabel(date, daysUntil)}
                </span>
                <span className="text-[11px] text-neutral-600">{date}</span>
                {daysUntil === 0 && (
                  <span className="rounded-full bg-orange-900/30 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-400">
                    Today
                  </span>
                )}
              </div>

              <div className="divide-y divide-neutral-800/60 rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden">
                {evs.map(ev => {
                  const isCrushWindow = isMicro && ev.daysUntil >= 5 && ev.daysUntil <= 7;
                  return (
                    <div
                      key={`${ev.symbol}:${ev.date}`}
                      className={`flex items-center gap-4 px-4 py-3 ${
                        isCrushWindow ? "bg-amber-900/10" : ""
                      }`}
                    >
                      {/* Symbol */}
                      <span className="w-14 shrink-0 font-mono text-sm font-bold text-neutral-100">
                        {ev.symbol}
                      </span>

                      {/* Name */}
                      <span className="min-w-0 flex-1 truncate text-xs text-neutral-500">
                        {ev.name}
                      </span>

                      {/* Timing badge */}
                      <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${timingBadgeClass(ev.timing)}`}>
                        {timingLabel(ev.timing)}
                      </span>

                      {/* IV crush window tag (micro only) */}
                      {isCrushWindow && (
                        <span className="shrink-0 rounded bg-amber-900/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-400">
                          IV crush
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-6 text-[11px] text-neutral-700">
        Source: Nasdaq earnings calendar · Refreshed hourly
      </p>
    </main>
  );
}
