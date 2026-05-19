import { getSession } from "@/src/lib/auth";
import { getTraderById } from "@/src/lib/traders";
import { alpacaForTrader } from "@/src/lib/alpaca";
import { money, signed, pct, num } from "@/src/lib/format";
import { TradingViewChart } from "@/src/components/trading/TradingViewChart";
import { ClosePositionForm } from "@/src/components/trading/ClosePositionForm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PositionPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { symbol } = await params;
  const { error } = await searchParams;
  const upper = symbol.toUpperCase();

  const traderId = await getSession();
  const trader = await getTraderById(traderId);
  if (!trader) return null;

  const alpaca = alpacaForTrader(trader);
  const [posResult, snapResult] = await Promise.allSettled([
    alpaca.getPosition(upper),
    alpaca.getSnapshot(upper),
  ]);

  if (posResult.status === "rejected") {
    return (
      <main className="mx-auto max-w-sm px-5 py-12 text-center">
        <p className="text-neutral-400">No open position in <span className="font-semibold">{upper}</span>.</p>
        <Link href="/" className="mt-4 block text-sm text-neutral-400 hover:text-white">← Dashboard</Link>
      </main>
    );
  }

  const pos = posResult.value;
  const snap = snapResult.status === "fulfilled" ? snapResult.value : null;
  const currentPrice = snap?.latestTrade?.p ?? snap?.latestQuote?.ap ?? parseFloat(pos.current_price);
  const prevClose = snap?.prevDailyBar?.c ?? null;
  const dayChange = prevClose ? currentPrice - prevClose : null;
  const dayChangePct = prevClose ? (currentPrice - prevClose) / prevClose : null;

  const unrealizedPl = parseFloat(pos.unrealized_pl);
  const unrealizedPlPct = parseFloat(pos.unrealized_plpc);
  const marketValue = parseFloat(pos.market_value);
  const avgEntry = parseFloat(pos.avg_entry_price);
  const qty = parseFloat(pos.qty);

  return (
    <main className="mx-auto max-w-sm px-5 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-3xl font-bold">{upper}</h1>
          <span className="font-mono text-2xl tabular-nums">{money(currentPrice)}</span>
        </div>
        {dayChange !== null && dayChangePct !== null && (
          <p className={`mt-1 text-sm ${dayChange >= 0 ? "text-green-400" : "text-red-400"}`}>
            {signed(dayChange, n => money(n))} ({signed(dayChangePct, n => pct(n))}) today
          </p>
        )}
      </div>

      {/* Chart */}
      <TradingViewChart symbol={upper} />

      <div className="my-6" />

      {/* Position stats */}
      <section className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900">
        <div className="grid grid-cols-2 divide-x divide-neutral-800 border-b border-neutral-800">
          <div className="px-4 py-3">
            <p className="text-xs text-neutral-500">Market value</p>
            <p className="mt-0.5 font-mono font-semibold tabular-nums">{money(marketValue)}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-neutral-500">Unrealized P&L</p>
            <p className={`mt-0.5 font-mono font-semibold tabular-nums ${unrealizedPl >= 0 ? "text-green-400" : "text-red-400"}`}>
              {signed(unrealizedPl, n => money(n))}
              <span className="ml-1.5 text-xs font-normal">
                ({signed(unrealizedPlPct, n => pct(n))})
              </span>
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-neutral-800">
          <div className="px-4 py-3">
            <p className="text-xs text-neutral-500">Qty</p>
            <p className="mt-0.5 font-mono tabular-nums">{num(qty)}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-neutral-500">Avg entry</p>
            <p className="mt-0.5 font-mono tabular-nums">{money(avgEntry)}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-neutral-500">Side</p>
            <p className={`mt-0.5 text-sm font-semibold ${pos.side === "long" ? "text-green-400" : "text-red-400"}`}>
              {pos.side.toUpperCase()}
            </p>
          </div>
        </div>
      </section>

      {/* Close form */}
      <ClosePositionForm
        symbol={upper}
        qty={pos.qty}
        error={error ? decodeURIComponent(error) : undefined}
      />

      <Link
        href={`/trade/${upper}`}
        className="mt-3 block w-full rounded-xl border border-neutral-700 py-3.5 text-center text-sm font-semibold text-neutral-300 transition hover:border-orange-400 hover:text-orange-400 hover:shadow-[0_0_16px_2px_rgba(251,146,60,0.25)]"
      >
        Trade {upper}
      </Link>

      <Link href="/" className="mt-6 block text-center text-sm text-neutral-400 hover:text-white">
        ← Dashboard
      </Link>
    </main>
  );
}
