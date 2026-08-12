import { getSession } from "@/src/lib/auth";
import { getTraderById } from "@/src/lib/traders";
import { strategiesForType, cashBufferPct, bufferConfig } from "@/src/lib/strategies";
import { alpacaForTrader } from "@/src/lib/alpaca";
import { db } from "@/src/db/client";
import { strategyTrades, engineRuns } from "@/src/db/schema";
import { eq, desc } from "drizzle-orm";
import { StrategyCard } from "@/src/components/strategies/StrategyCard";
import { EngineLog, type EngineRunRow } from "@/src/components/strategies/EngineLog";
import { money } from "@/src/lib/format";

export const dynamic = "force-dynamic";

export default async function StrategiesPage() {
  const traderId = await getSession();
  const trader = await getTraderById(traderId);
  if (!trader) throw new Error("Unknown trader");

  const strategies = strategiesForType(trader.type);

  // Fetch live equity so allocation dollar amounts stay current
  const alpaca = alpacaForTrader(trader);
  const account = await alpaca.getAccount();
  const equity = parseFloat(account.equity);

  // Fetch strategy tags + recent engine runs in parallel
  const [tags, recentRuns] = await Promise.all([
    db.select().from(strategyTrades).where(eq(strategyTrades.traderId, traderId)),
    db.select().from(engineRuns)
      .where(eq(engineRuns.traderId, traderId))
      .orderBy(desc(engineRuns.runAt))
      .limit(100) as Promise<EngineRunRow[]>,
  ]);

  // Group tagged symbols by strategy slug
  const symbolsBySlug = new Map<string, Set<string>>();
  for (const tag of tags) {
    if (!symbolsBySlug.has(tag.strategySlug)) symbolsBySlug.set(tag.strategySlug, new Set());
    symbolsBySlug.get(tag.strategySlug)!.add(tag.symbol);
  }

  const isMicro = trader.type === "micro";
  const typeLabel = isMicro ? "Micro" : "Macro";
  const typeColor = isMicro ? "text-sky-400 bg-sky-400/10" : "text-emerald-400 bg-emerald-400/10";

  // Compute budget totals
  const buffer = bufferConfig(trader.type);
  const totalBufferPct = cashBufferPct(trader.type);
  const hardCashDollars = equity * (buffer.hardCashPct / 100);
  const investedBufferDollars = equity * (buffer.investedPct / 100);
  const strategyTotal = strategies.reduce((s, st) => s + st.allocationPct, 0);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold">Strategies</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${typeColor}`}>
          {typeLabel}
        </span>
      </div>

      <p className="mb-5 text-sm text-neutral-500">
        {isMicro
          ? "Your strategies use short-term technical signals and options to capture quick moves. Tag each trade to a strategy to track what's working."
          : "Your strategies focus on longer time horizons — sector rotation, quality stocks, and position sizing over weeks to months. Tag each trade to track your thesis."}
      </p>

      {/* Portfolio budget — recomputed from live equity each load */}
      <section className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Portfolio budget
          </span>
          <span className="font-mono text-sm font-bold tabular-nums text-neutral-100">
            {money(equity)}
          </span>
        </div>

        <div className="mb-3 space-y-1.5">
          {strategies.map(st => {
            const dollars = equity * (st.allocationPct / 100);
            return (
              <div key={st.slug} className="flex items-center gap-2">
                <div
                  className="h-1.5 rounded-full bg-neutral-600"
                  style={{ width: `${st.allocationPct}%`, maxWidth: "100%" }}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-neutral-500">{st.name}</span>
                <span className="shrink-0 font-mono text-xs font-medium tabular-nums text-neutral-300">
                  {money(dollars)}
                </span>
                <span className="shrink-0 text-xs text-neutral-600">{st.allocationPct}%</span>
              </div>
            );
          })}
          {/* Hard cash reserve — always idle, instant margin protection */}
          <div className="flex items-center gap-2">
            <div
              className="h-1.5 rounded-full bg-neutral-800"
              style={{ width: `${buffer.hardCashPct}%`, maxWidth: "100%" }}
            />
            <span className="min-w-0 flex-1 truncate text-xs text-neutral-600">Hard cash reserve</span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-neutral-600">
              {money(hardCashDollars)}
            </span>
            <span className="shrink-0 text-xs text-neutral-700">{buffer.hardCashPct}%</span>
          </div>

          {/* Invested buffer — T-bill ETF, earns yield, liquidates in 1 day */}
          {buffer.investedPct > 0 && (
            <div className="flex items-center gap-2">
              <div
                className="h-1.5 rounded-full bg-sky-900/60"
                style={{ width: `${buffer.investedPct}%`, maxWidth: "100%" }}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-sky-700">
                {buffer.investedTickerName}
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-sky-700">
                {money(investedBufferDollars)}
              </span>
              <span className="shrink-0 text-xs text-sky-800">{buffer.investedPct}%</span>
            </div>
          )}
        </div>

        {buffer.investedPct > 0 && (
          <div className="mb-2 rounded-md border border-sky-900/40 bg-sky-900/10 px-3 py-2 text-[11px] text-sky-600">
            {buffer.investedTickerName} earns T-bill yield (~5%/yr) while it waits. Sell it any trading day — proceeds clear next morning for margin or new trades. Amount scales with your account automatically.
          </div>
        )}

        <div className="border-t border-neutral-800 pt-2 text-[10px] text-neutral-600">
          Amounts update automatically with your account balance · {strategyTotal + totalBufferPct}% allocated
        </div>
      </section>

      <div className="flex flex-col gap-4">
        {strategies.map(strategy => (
          <StrategyCard
            key={strategy.slug}
            strategy={strategy}
            activePl={null}
            traderType={trader.type}
            accountEquity={equity}
          />
        ))}
      </div>

      <EngineLog runs={recentRuns} />
    </main>
  );
}
