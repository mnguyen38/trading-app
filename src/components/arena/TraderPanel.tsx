import type { Competitor } from "@/src/lib/arena";
import { SIDE_LABEL } from "@/src/lib/arena";
import { parseOptionSymbol } from "@/src/lib/alpaca";
import { strategiesForType } from "@/src/lib/strategies";
import { money, num, pct, signed } from "@/src/lib/format";

function plClass(v: number) {
  return v >= 0 ? "text-green-400" : "text-red-400";
}

function symbolLabel(symbol: string) {
  const opt = parseOptionSymbol(symbol);
  if (!opt) return symbol;
  const [, m, d] = opt.expiry.split("-");
  return `${opt.underlying} ${opt.strike}${opt.contractType === "call" ? "C" : "P"} ${parseInt(m)}/${parseInt(d)}`;
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-neutral-500">{children}</h3>
      {right}
    </div>
  );
}

export function TraderPanel({ c }: { c: Competitor }) {
  const strategies = strategiesForType(c.trader.type);

  const plBySymbol = new Map(c.positions.map(p => [p.symbol, parseFloat(p.unrealized_pl)]));
  const perStrategy = strategies.map(s => {
    const symbols = new Set(c.strategyTrades.filter(t => t.strategySlug === s.slug).map(t => t.symbol));
    let openPl = 0;
    let openCount = 0;
    for (const sym of symbols) {
      const pl = plBySymbol.get(sym);
      if (pl !== undefined) { openPl += pl; openCount += 1; }
    }
    return { strategy: s, tagged: symbols.size, openPl, openCount };
  });

  return (
    <div className="min-w-0 px-8 py-7">
      <div className="mb-6 flex items-center gap-3">
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.color }} />
        <h2 className="text-lg font-bold">{c.trader.name}</h2>
        <span className="text-xs text-neutral-500">{SIDE_LABEL[c.trader.type]}</span>
      </div>

      {c.error && (
        <div className="mb-5 rounded-md border border-red-900/60 bg-red-950/30 px-4 py-2.5 text-xs text-red-300">
          Alpaca data unavailable: {c.error}
        </div>
      )}

      {/* Strategy P&L */}
      <section className="mb-8">
        <SectionTitle>Strategies</SectionTitle>
        <div className="divide-y divide-neutral-800/70 border-y border-neutral-800/70">
          {perStrategy.map(({ strategy, tagged, openPl, openCount }) => (
            <div key={strategy.slug} className="flex items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-neutral-200">{strategy.name}</div>
                <div className="text-[11px] text-neutral-600">
                  {strategy.allocationPct}% allocation · {tagged} trade{tagged === 1 ? "" : "s"} tagged · {openCount} open
                </div>
              </div>
              <div className="w-28 shrink-0">
                <div className="h-1 overflow-hidden rounded-full bg-neutral-800">
                  <div className="h-full rounded-full" style={{ width: `${strategy.allocationPct}%`, backgroundColor: c.color }} />
                </div>
              </div>
              <div className={`w-24 shrink-0 text-right font-mono text-sm tabular-nums ${openCount > 0 ? plClass(openPl) : "text-neutral-700"}`}>
                {openCount > 0 ? signed(openPl, n => money(n)) : "—"}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Positions */}
      <section className="mb-8">
        <SectionTitle right={<span className="text-[11px] text-neutral-600">{c.positions.length} open</span>}>
          Positions
        </SectionTitle>
        {c.positions.length === 0 ? (
          <p className="border-y border-dashed border-neutral-800 py-6 text-center text-xs text-neutral-600">
            No open positions
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-[10px] uppercase tracking-wider text-neutral-600">
                <th className="pb-2 font-medium">Symbol</th>
                <th className="pb-2 text-right font-medium">Qty</th>
                <th className="pb-2 text-right font-medium">Avg</th>
                <th className="pb-2 text-right font-medium">Last</th>
                <th className="pb-2 text-right font-medium">Value</th>
                <th className="pb-2 text-right font-medium">P&amp;L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/60 font-mono tabular-nums">
              {c.positions.map(p => {
                const pl = parseFloat(p.unrealized_pl);
                const plpc = parseFloat(p.unrealized_plpc);
                return (
                  <tr key={p.symbol}>
                    <td className="py-2.5 font-sans font-semibold">{symbolLabel(p.symbol)}</td>
                    <td className="py-2.5 text-right text-neutral-400">{num(p.qty)}</td>
                    <td className="py-2.5 text-right text-neutral-400">{money(p.avg_entry_price)}</td>
                    <td className="py-2.5 text-right text-neutral-400">{money(p.current_price)}</td>
                    <td className="py-2.5 text-right">{money(p.market_value)}</td>
                    <td className={`py-2.5 text-right ${plClass(pl)}`}>
                      {signed(pl, n => money(n))}
                      <span className="ml-1.5 text-[11px] opacity-70">{signed(plpc, n => pct(n, 1))}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Open orders */}
      {c.openOrders.length > 0 && (
        <section>
          <SectionTitle right={<span className="text-[11px] text-neutral-600">{c.openOrders.length} working</span>}>
            Open orders
          </SectionTitle>
          <div className="divide-y divide-neutral-800/60 border-y border-neutral-800/70 text-sm">
            {c.openOrders.map(o => (
              <div key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <span className={`mr-2 text-xs font-bold ${o.side === "buy" ? "text-green-400" : "text-red-400"}`}>
                    {o.side.toUpperCase()}
                  </span>
                  <span className="font-semibold">{symbolLabel(o.symbol)}</span>
                  <span className="ml-2 text-xs text-neutral-500">
                    {o.type}
                    {o.limit_price ? ` @ ${money(o.limit_price)}` : ""}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-neutral-500">{o.qty ?? "—"} · {o.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
