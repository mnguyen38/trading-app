import { getUpcomingEarnings, type EarningsEvent } from "@/src/lib/engine/earningsFetcher";
import { PageHeader } from "@/src/components/arena/PageHeader";

export const dynamic = "force-dynamic";

function timingLabel(timing: EarningsEvent["timing"]) {
  if (timing === "amc") return "After close";
  if (timing === "bmo") return "Before open";
  return "Time TBD";
}

function timingBadgeClass(timing: EarningsEvent["timing"]) {
  if (timing === "amc") return "text-purple-400 bg-purple-900/60";
  if (timing === "bmo") return "text-blue-400 bg-blue-900/60";
  return "text-neutral-500 bg-neutral-800";
}

function dayLabel(dateStr: string, daysUntil: number) {
  if (daysUntil === 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export default async function EarningsPage() {
  const events = await getUpcomingEarnings(14).catch(() => [] as EarningsEvent[]);

  const byDate = new Map<string, EarningsEvent[]>();
  for (const ev of events) {
    if (!byDate.has(ev.date)) byDate.set(ev.date, []);
    byDate.get(ev.date)!.push(ev);
  }
  const days = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div>
      <PageHeader eyebrow="Next 14 days" title="Earnings">
        Upcoming reports for the watchlist. Source: Nasdaq calendar, refreshed hourly.
      </PageHeader>

      {days.length === 0 ? (
        <p className="px-6 py-20 text-center text-sm text-neutral-600">
          No earnings in the next 14 days for the watchlist.
        </p>
      ) : (
        <div className="grid divide-neutral-800 xl:grid-cols-2 xl:divide-x">
          {days.map(([date, evs]) => {
            const daysUntil = evs[0].daysUntil;
            return (
              <section key={date} className="min-w-0 border-b border-neutral-800 px-6 py-5 lg:px-14">
                <div className="mb-3 flex items-baseline gap-2">
                  <span className={`text-sm font-semibold ${daysUntil === 0 ? "text-orange-400" : "text-neutral-200"}`}>
                    {dayLabel(date, daysUntil)}
                  </span>
                  <span className="text-[11px] text-neutral-600">{date}</span>
                </div>
                <div className="divide-y divide-neutral-800/60 border-y border-neutral-800/60">
                  {evs.map(ev => (
                    <div key={`${ev.symbol}:${ev.date}`} className="flex items-center gap-4 py-2.5">
                      <span className="w-16 shrink-0 font-mono text-sm font-bold">{ev.symbol}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-neutral-500">{ev.name}</span>
                      <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${timingBadgeClass(ev.timing)}`}>
                        {timingLabel(ev.timing)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
