"use client";

import { useState } from "react";

type Signal = { strategy: string; underlying: string; reason: string; log?: string[] };
type Trade  = { strategy: string; symbol: string; side: string; qty: number };
type Skip   = { strategy: string; reason: string; log?: string[] };
type Err    = { strategy: string; error: string };

export type EngineRunRow = {
  id: string;
  phase: string;
  runAt: Date;
  signals: Signal[] | null;
  trades:  Trade[]  | null;
  skipped: Skip[]   | null;
  errors:  Err[]    | null;
};

function relativeTime(d: Date) {
  const diff = Date.now() - new Date(d).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function strategyLabel(slug: string) {
  const map: Record<string, string> = {
    "vol-spread-long":    "Vol-Spread Long",
    "vrp-premium-seller": "VRP Premium Seller",
    "earnings-iv-crush":  "Earnings IV Crush",
    "vrp-inversion-long": "VRP Inversion Long",
    "quality-hold":       "Quality Hold",
    "sector-rotation":    "Sector Rotation",
    "economic-cycle":     "Economic Cycle",
    "swing-trade":        "Swing Trade",
  };
  return map[slug] ?? slug;
}

function RunCard({ run }: { run: EngineRunRow }) {
  const [expanded, setExpanded] = useState(false);

  const signals = run.signals ?? [];
  const trades  = run.trades  ?? [];
  const skipped = run.skipped ?? [];
  const errors  = run.errors  ?? [];

  const hasActivity = signals.length > 0 || trades.length > 0 || errors.length > 0 || skipped.length > 0;
  const isEntry = run.phase === "entry";

  return (
    <div className={`rounded-xl border ${hasActivity ? "border-neutral-700 bg-neutral-900" : "border-neutral-800/50 bg-neutral-900/40"} overflow-hidden`}>
      {/* Header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {/* Phase pill */}
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          isEntry ? "bg-sky-900/40 text-sky-400" : "bg-orange-900/40 text-orange-400"
        }`}>
          {isEntry ? "Entry" : "Exit"}
        </span>

        {/* Summary */}
        <span className="flex-1 text-xs">
          {signals.length > 0 ? (
            <span className="text-neutral-200">
              {signals.map(s => s.underlying).join(", ")}
              <span className="ml-1.5 text-neutral-500">
                · {signals.length} signal{signals.length !== 1 ? "s" : ""}, {trades.length} trade{trades.length !== 1 ? "s" : ""}
                {skipped.length > 0 && `, ${skipped.length} skipped`}
              </span>
            </span>
          ) : errors.length > 0 ? (
            <span className="text-red-400">{errors.length} error{errors.length !== 1 ? "s" : ""}</span>
          ) : skipped.length > 0 ? (
            <span className="text-neutral-500">{skipped.length} strategies scanned — no signals</span>
          ) : (
            <span className="text-neutral-600">No signals</span>
          )}
        </span>

        {/* Time */}
        <span className="shrink-0 text-[11px] text-neutral-600">{relativeTime(run.runAt)}</span>

        {/* Expand chevron */}
        {hasActivity && (
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none"
            className={`shrink-0 text-neutral-600 transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {/* Expanded detail */}
      {expanded && hasActivity && (
        <div className="border-t border-neutral-800 px-4 pb-4 pt-3 space-y-4">

          {/* Signals fired — the "why it triggered" */}
          {signals.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Signals fired</p>
              <div className="space-y-2">
                {signals.map((s, i) => (
                  <div key={i} className="rounded-lg bg-emerald-900/10 border border-emerald-900/30 px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm font-bold text-neutral-100">{s.underlying}</span>
                      <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400">
                        {strategyLabel(s.strategy)}
                      </span>
                    </div>
                    <p className="text-xs text-emerald-400 leading-relaxed font-medium">{s.reason}</p>
                    {s.log && s.log.length > 0 && (
                      <div className="mt-2 space-y-0.5 border-t border-neutral-800 pt-2">
                        {s.log.map((line, j) => (
                          <p key={j} className="font-mono text-[10px] text-neutral-500 leading-relaxed">{line}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skipped strategies — the "why it didn't trigger" */}
          {skipped.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Why other strategies didn&apos;t fire</p>
              <div className="space-y-2">
                {skipped.map((s, i) => (
                  <div key={i} className="rounded-lg bg-neutral-800/30 px-3 py-2">
                    <p className="text-[11px] font-semibold text-neutral-400 mb-1">{strategyLabel(s.strategy)}</p>
                    {s.log && s.log.length > 0 ? (
                      <div className="space-y-0.5">
                        {s.log.map((line, j) => (
                          <p key={j} className={`font-mono text-[10px] leading-relaxed ${line.includes("✓ SIGNAL") ? "text-emerald-400" : "text-neutral-600"}`}>
                            {line}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="font-mono text-[10px] text-neutral-600">{s.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trades placed */}
          {trades.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Orders placed</p>
              <div className="space-y-1">
                {trades.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg bg-neutral-800/30 px-3 py-2">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      t.side === "buy" ? "bg-emerald-900/40 text-emerald-400" : "bg-red-900/40 text-red-400"
                    }`}>
                      {t.side}
                    </span>
                    <span className="font-mono text-sm text-neutral-200">{t.symbol}</span>
                    <span className="text-xs text-neutral-500">×{t.qty}</span>
                    <span className="ml-auto text-[10px] text-neutral-600">{strategyLabel(t.strategy)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-red-600">Errors</p>
              <div className="space-y-1">
                {errors.map((e, i) => (
                  <div key={i} className="rounded-lg bg-red-900/10 border border-red-900/30 px-3 py-2">
                    <p className="text-[10px] text-red-400 font-medium mb-0.5">{strategyLabel(e.strategy)}</p>
                    <p className="text-xs text-red-500/80 font-mono break-all">{e.error}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Exact timestamp */}
          <p className="text-[10px] text-neutral-700">
            {new Date(run.runAt).toLocaleString("en-US", {
              month: "short", day: "numeric",
              hour: "numeric", minute: "2-digit",
              hour12: true, timeZoneName: "short",
            })}
          </p>
        </div>
      )}
    </div>
  );
}

export function EngineLog({ runs }: { runs: EngineRunRow[] }) {
  const [showAll, setShowAll] = useState(false);

  // Only show runs with activity by default; show silent runs when expanded
  const active  = runs.filter(r => (r.signals?.length ?? 0) > 0 || (r.trades?.length ?? 0) > 0 || (r.errors?.length ?? 0) > 0);
  const visible = showAll ? runs : active;

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Engine activity
        </span>
        {runs.length > active.length && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="text-[11px] text-neutral-600 hover:text-neutral-400 transition"
          >
            {showAll ? "Hide silent runs" : `+${runs.length - active.length} silent runs`}
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-5 py-8 text-center text-sm text-neutral-600">
          No engine activity yet — engine runs automatically during market hours.
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(run => <RunCard key={run.id} run={run} />)}
        </div>
      )}
    </section>
  );
}
