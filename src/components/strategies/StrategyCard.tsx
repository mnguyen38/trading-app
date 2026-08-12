"use client";
import { useState } from "react";
import Link from "next/link";
import type { Strategy } from "@/src/lib/strategies";
import { money, signed } from "@/src/lib/format";

type Props = {
  strategy: Strategy;
  activePl: number | null;
  traderType: "micro" | "macro";
  accountEquity: number;
};

const POSTURE_LABEL: Record<Strategy["posture"], string> = {
  long_vol:    "Long vol",
  short_vol:   "Short vol (sell premium)",
  directional: "Directional",
};

const POSTURE_COLOR: Record<Strategy["posture"], string> = {
  long_vol:    "text-sky-400 bg-sky-400/10 border-sky-400/20",
  short_vol:   "text-violet-400 bg-violet-400/10 border-violet-400/20",
  directional: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
};

export function StrategyCard({ strategy, activePl, traderType, accountEquity }: Props) {
  const [detailOpen, setDetailOpen] = useState(false);

  const hasPl = activePl !== null;
  const ctaColor = traderType === "micro"
    ? "bg-sky-500/15 text-sky-400 hover:bg-sky-500/25"
    : "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25";

  // Compute live dollar allocation from actual account equity
  const bucketDollars = accountEquity * (strategy.allocationPct / 100);
  const perPositionDollars = bucketDollars / strategy.maxPositions;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-bold text-neutral-100">{strategy.name}</h2>
            {hasPl && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${activePl >= 0 ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                {signed(activePl, n => money(n))} active
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {strategy.timeHorizon} · {strategy.instruments}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${POSTURE_COLOR[strategy.posture]}`}>
          {POSTURE_LABEL[strategy.posture]}
        </span>
      </div>

      {/* Live budget pill */}
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/60 px-3 py-1.5">
          <span className="text-[10px] uppercase tracking-wide text-neutral-500">Budget</span>
          <span className="font-mono text-xs font-bold tabular-nums text-neutral-200">
            {money(bucketDollars)}
          </span>
          <span className="text-[10px] text-neutral-600">({strategy.allocationPct}%)</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/60 px-3 py-1.5">
          <span className="text-[10px] uppercase tracking-wide text-neutral-500">Per position</span>
          <span className="font-mono text-xs font-bold tabular-nums text-neutral-200">
            {money(perPositionDollars)}
          </span>
          <span className="text-[10px] text-neutral-600">max {strategy.maxPositions}</span>
        </div>
      </div>

      {/* Thesis */}
      <p className="mb-4 text-sm leading-relaxed text-neutral-400">{strategy.thesis}</p>

      {/* Entry signal highlight */}
      <div className="mb-4 rounded-lg border border-orange-400/20 bg-orange-400/5 px-4 py-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-orange-400">Entry signal</div>
        <p className="text-xs text-neutral-300">{strategy.entrySignal}</p>
      </div>

      {/* Example tickers */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {strategy.exampleTickers.map(t => (
          <span key={t} className="rounded-md bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-300">
            {t}
          </span>
        ))}
      </div>

      {/* Collapsible detail: rules + academic basis + risk note */}
      <button
        type="button"
        onClick={() => setDetailOpen(o => !o)}
        className="mb-3 flex w-full items-center justify-between text-xs font-medium text-neutral-500 hover:text-neutral-300 transition"
      >
        <span>Rules, research basis &amp; risks</span>
        <span>{detailOpen ? "▲" : "▼"}</span>
      </button>

      {detailOpen && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-xs">

          {/* Live position sizing based on current equity */}
          <div>
            <div className="mb-2 font-semibold text-blue-400">Position sizing (live)</div>
            <div className="mb-2 grid grid-cols-3 gap-2">
              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-2 text-center">
                <div className="text-[10px] text-neutral-500">Strategy bucket</div>
                <div className="mt-0.5 font-mono font-bold tabular-nums text-neutral-200">{money(bucketDollars)}</div>
                <div className="text-[10px] text-neutral-600">{strategy.allocationPct}% of equity</div>
              </div>
              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-2 text-center">
                <div className="text-[10px] text-neutral-500">Per position</div>
                <div className="mt-0.5 font-mono font-bold tabular-nums text-neutral-200">{money(perPositionDollars)}</div>
                <div className="text-[10px] text-neutral-600">max {strategy.maxPositions} open</div>
              </div>
              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-2 text-center">
                <div className="text-[10px] text-neutral-500">Equity</div>
                <div className="mt-0.5 font-mono font-bold tabular-nums text-neutral-200">{money(accountEquity)}</div>
                <div className="text-[10px] text-neutral-600">updates live</div>
              </div>
            </div>
            <p className="text-neutral-600">{strategy.perTradeSizing}</p>
          </div>

          <div>
            <div className="mb-1.5 font-semibold text-green-400">When to enter</div>
            <ul className="space-y-1 text-neutral-400">
              {strategy.buyRules.map((r, i) => (
                <li key={i} className="flex gap-2"><span className="shrink-0 text-green-500">↑</span>{r}</li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-1.5 font-semibold text-red-400">When to exit</div>
            <ul className="space-y-1 text-neutral-400">
              {strategy.sellRules.map((r, i) => (
                <li key={i} className="flex gap-2"><span className="shrink-0 text-red-500">↓</span>{r}</li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-1.5 font-semibold text-amber-400">Key risk</div>
            <p className="text-neutral-400">{strategy.riskNote}</p>
          </div>

          <div>
            <div className="mb-1.5 font-semibold text-neutral-500">Academic basis</div>
            <p className="italic text-neutral-600">{strategy.academicBasis}</p>
          </div>
        </div>
      )}

      {/* CTA */}
      <Link
        href="/trade"
        className={`block w-full rounded-lg py-2.5 text-center text-sm font-semibold transition ${ctaColor}`}
      >
        Trade this strategy →
      </Link>
    </div>
  );
}
