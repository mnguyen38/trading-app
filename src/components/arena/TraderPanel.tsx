import type { Competitor } from "@/src/lib/arena";
import { SIDE_LABEL } from "@/src/lib/arena";
import { parseOptionSymbol } from "@/src/lib/alpaca";
import { positionUnderlying } from "@/src/lib/engine/signals";
import { strategiesForType } from "@/src/lib/strategies";
import { money, num, pct, signed } from "@/src/lib/format";

const plClass = (v: number) => (v >= 0 ? "text-up" : "text-down");
const arrow = (v: number) => (v >= 0 ? "▲" : "▼");

function symbolLabel(symbol: string) {
  const opt = parseOptionSymbol(symbol);
  if (!opt) return symbol;
  const [, m, d] = opt.expiry.split("-");
  return `${opt.underlying} ${opt.strike}${opt.contractType === "call" ? "C" : "P"} ${parseInt(m)}/${parseInt(d)}`;
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{children}</h3>
      {right}
    </div>
  );
}

// One competitor's card: strategies, open positions and working orders.
export function TraderPanel({ c }: { c: Competitor }) {
  const strategies = strategiesForType(c.trader.type);

  // Keyed by underlying, not the exact position symbol — strategyTrades.symbol stores the
  // underlying ticker (e.g. "AAPL"), while an option position's own symbol is the full OCC
  // contract (e.g. "AAPL260117C00150000"). Keying this map by p.symbol directly meant it
  // could never match an options strategy's tagged symbols at all, so every options
  // strategy always showed $0 / 0 open here regardless of real P&L.
  // Summed, not just set, so a straddle's two legs (same underlying) both count instead of
  // the second leg silently overwriting the first.
  const plBySymbol = new Map<string, number>();
  for (const p of c.positions) {
    const underlying = positionUnderlying(p.symbol);
    plBySymbol.set(underlying, (plBySymbol.get(underlying) ?? 0) + parseFloat(p.unrealized_pl));
  }
  const perStrategy = strategies.map(s => {
    const symbols = new Set(c.strategyTrades.filter(t => t.strategySlug === s.slug).map(t => t.symbol));
    let openPl = 0;
    let openCount = 0;
    for (const sym of symbols) {
      const pl = plBySymbol.get(sym);
      if (pl !== undefined) { openPl += pl; openCount += 1; }
    }
    return { strategy: s, openPl, openCount };
  });

  return (
    <div
      className="min-w-0 rounded-sm border border-t-[5px] border-line bg-card px-8 py-7"
      style={{ borderTopColor: c.color }}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-3xl font-semibold" style={{ color: c.color }}>{c.trader.name}</h2>
        <span className="text-sm text-muted">{SIDE_LABEL[c.trader.type]}</span>
      </div>

      {c.error && (
        <div className="mt-4 rounded-sm border border-red-900 bg-red-950 px-4 py-2.5 text-sm text-down">
          Alpaca data unavailable: {c.error}
        </div>
      )}

      <div className="mt-5">
        <SectionTitle>Strategies</SectionTitle>
        <div className="divide-y divide-line border-y border-line">
          {perStrategy.map(({ strategy, openPl, openCount }) => (
            <div key={strategy.slug} className="flex items-center gap-4 py-3 text-[15px]">
              <div className="w-44 shrink-0 truncate font-semibold">{strategy.name}</div>
              <div className="h-1.5 flex-1 rounded-full bg-line">
                <div className="h-1.5 rounded-full" style={{ width: `${strategy.allocationPct * 2}%`, backgroundColor: c.color }} />
              </div>
              <div className="w-10 shrink-0 text-right text-muted">{strategy.allocationPct}%</div>
              <div className={`w-28 shrink-0 text-right font-semibold tabular-nums ${openCount > 0 ? plClass(openPl) : "text-muted"}`}>
                {openCount > 0 ? `${arrow(openPl)} ${signed(openPl, n => money(n, 0))}` : "—"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <SectionTitle right={<span className="text-xs text-muted">{c.positions.length} open</span>}>
          Open positions
        </SectionTitle>
        {c.positions.length === 0 ? (
          <p className="border-y border-dashed border-line py-6 text-center text-sm text-muted">No open positions</p>
        ) : (
          <div className="divide-y divide-line border-y border-line text-[15px]">
            {c.positions.map(p => {
              const pl = parseFloat(p.unrealized_pl);
              return (
                <div key={p.symbol} className="flex items-center py-2.5">
                  <div className="w-44 shrink-0 truncate font-semibold">{symbolLabel(p.symbol)}</div>
                  <div className="w-14 shrink-0 text-muted tabular-nums">{num(p.qty)}</div>
                  <div className="flex-1 text-right tabular-nums">{money(p.market_value, 0)}</div>
                  <div className={`w-32 shrink-0 text-right font-semibold tabular-nums ${plClass(pl)}`}>
                    {arrow(pl)} {signed(pl, n => money(n, 0))}
                    <span className="ml-1.5 text-xs font-normal opacity-75">{signed(parseFloat(p.unrealized_plpc), n => pct(n, 1))}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {c.openOrders.length > 0 && (
        <div className="mt-6">
          <SectionTitle right={<span className="text-xs text-muted">{c.openOrders.length} working</span>}>
            Open orders
          </SectionTitle>
          <div className="divide-y divide-line border-y border-line text-[15px]">
            {c.openOrders.map(o => (
              <div key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <span className={`mr-2 text-xs font-bold ${o.side === "buy" ? "text-up" : "text-down"}`}>
                    {o.side.toUpperCase()}
                  </span>
                  <span className="font-semibold">{symbolLabel(o.symbol)}</span>
                  <span className="ml-2 text-xs text-muted">
                    {o.type}
                    {o.limit_price ? ` @ ${money(o.limit_price)}` : ""}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-muted">{o.qty ?? "—"} · {o.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
