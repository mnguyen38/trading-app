import { getSession } from "@/src/lib/auth";
import { getTraderById } from "@/src/lib/traders";
import { alpacaForTrader } from "@/src/lib/alpaca";
import { money, signed, pct } from "@/src/lib/format";
import { TradeForm } from "@/src/components/trading/TradeForm";
import { OptionsOrderForm } from "@/src/components/trading/OptionsOrderForm";
import { TradingViewChart } from "@/src/components/trading/TradingViewChart";
import { strategiesForType } from "@/src/lib/strategies";

export const dynamic = "force-dynamic";

export default async function TradeSymbolPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ error?: string; tab?: string }>;
}) {
  const { symbol } = await params;
  const { error, tab } = await searchParams;
  const upper = symbol.toUpperCase();

  const traderId = await getSession();
  const trader = await getTraderById(traderId);
  if (!trader) return null;

  const isMicro = trader.type === "micro";
  const strategies = strategiesForType(trader.type);
  const alpaca = alpacaForTrader(trader);

  const fetches = await Promise.allSettled([
    alpaca.getAccount(),
    alpaca.getSnapshot(upper),
    ...(isMicro ? [alpaca.getOptionsContracts(upper, { limit: 100 })] : []),
  ]);

  const [accountResult, snapshotResult, contractsResult] = fetches;

  const buyingPower = accountResult.status === "fulfilled"
    ? parseFloat(accountResult.value.buying_power)
    : 0;

  const snap = snapshotResult.status === "fulfilled" ? snapshotResult.value : null;
  const price = snap?.latestTrade?.p ?? snap?.latestQuote?.ap ?? null;
  const prevClose = snap?.prevDailyBar?.c ?? null;
  const change = price && prevClose ? price - prevClose : null;
  const changePct = price && prevClose ? (price - prevClose) / prevClose : null;

  const contracts = isMicro && contractsResult?.status === "fulfilled"
    ? (contractsResult.value as Awaited<ReturnType<typeof alpaca.getOptionsContracts>>).option_contracts
    : [];

  const activeTab = isMicro ? (tab === "options" ? "options" : "stock") : "stock";

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

      {/* Stock / Options tab toggle (micro traders only) */}
      {isMicro && (
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
          <a
            href={`/trade/${upper}`}
            className={`rounded-md py-2 text-center text-xs font-medium transition ${
              activeTab === "stock" ? "bg-neutral-700 text-white" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Stock
          </a>
          <a
            href={`/trade/${upper}?tab=options`}
            className={`rounded-md py-2 text-center text-xs font-medium transition ${
              activeTab === "options" ? "bg-neutral-700 text-white" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Options
          </a>
        </div>
      )}

      {activeTab === "options" ? (
        <OptionsOrderForm
          underlying={upper}
          contracts={contracts}
          strategies={strategies}
          error={error ? decodeURIComponent(error) : undefined}
        />
      ) : (
        <TradeForm
          symbol={upper}
          price={price}
          buyingPower={buyingPower}
          strategies={strategies}
          error={error ? decodeURIComponent(error) : undefined}
        />
      )}
    </main>
  );
}
