import { getSession } from "@/src/lib/auth";
import { getTraderById } from "@/src/lib/traders";
import { alpacaForTrader } from "@/src/lib/alpaca";
import { money, signed, pct } from "@/src/lib/format";
import { TradeForm } from "@/src/components/trading/TradeForm";
import { TradingViewChart } from "@/src/components/trading/TradingViewChart";

export const dynamic = "force-dynamic";

export default async function TradeSymbolPage({
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
  const [account, snapshot] = await Promise.allSettled([
    alpaca.getAccount(),
    alpaca.getSnapshot(upper),
  ]);

  const buyingPower = account.status === "fulfilled"
    ? parseFloat(account.value.buying_power)
    : 0;

  const snap = snapshot.status === "fulfilled" ? snapshot.value : null;
  const price = snap?.latestTrade?.p ?? snap?.latestQuote?.ap ?? null;
  const prevClose = snap?.prevDailyBar?.c ?? null;
  const change = price && prevClose ? price - prevClose : null;
  const changePct = price && prevClose ? (price - prevClose) / prevClose : null;

  return (
    <main className="mx-auto max-w-sm px-5 py-8">
      {/* Symbol header */}
      <div className="mb-8">
        <div className="flex items-baseline gap-3">
          <h1 className="text-3xl font-bold">{upper}</h1>
          {price && (
            <span className="font-mono text-2xl tabular-nums">{money(price)}</span>
          )}
        </div>
        {change !== null && changePct !== null && (
          <p className={`mt-1 text-sm ${change >= 0 ? "text-green-400" : "text-red-400"}`}>
            {signed(change, n => money(n))} ({signed(changePct, n => pct(n))}) today
          </p>
        )}
        {!price && (
          <p className="mt-1 text-sm text-neutral-500">Price unavailable — check the symbol.</p>
        )}
      </div>

      <TradingViewChart symbol={upper} />

      <div className="my-6" />

      <TradeForm
        symbol={upper}
        price={price}
        buyingPower={buyingPower}
        error={error ? decodeURIComponent(error) : undefined}
      />
    </main>
  );
}
