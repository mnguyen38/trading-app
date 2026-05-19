"use client";
import { useState } from "react";
import { closePosition } from "@/src/server/actions/position";

type Props = {
  symbol: string;
  qty: string;
  error?: string;
};

export function ClosePositionForm({ symbol, qty, error }: Props) {
  const [mode, setMode] = useState<"full" | "partial">("full");
  const totalQty = parseFloat(qty);

  return (
    <div className="flex flex-col gap-3">
      {/* Mode toggle */}
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
        {(["full", "partial"] as const).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md py-1.5 text-xs font-medium transition ${
              mode === m ? "bg-neutral-700 text-white" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {m === "full" ? "Close All" : "Partial Close"}
          </button>
        ))}
      </div>

      <form action={closePosition} className="flex flex-col gap-3">
        <input type="hidden" name="symbol" value={symbol} />
        <input type="hidden" name="mode" value={mode} />

        {mode === "partial" && (
          <div>
            <label htmlFor="close_qty" className="mb-1.5 block text-xs text-neutral-500">
              Shares to close <span className="text-neutral-600">(max {qty})</span>
            </label>
            <input
              id="close_qty"
              type="number"
              name="qty"
              min="0.01"
              max={totalQty}
              step="any"
              required
              placeholder="0"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 font-mono text-right focus:border-orange-400/60 focus:outline-none"
            />
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-red-950 px-4 py-2 text-sm text-red-400">{error}</p>
        )}

        <button
          type="submit"
          className="w-full rounded-xl bg-red-500 py-3.5 text-sm font-semibold text-white transition hover:bg-red-400 active:scale-[0.98]"
        >
          {mode === "full" ? `Close ${symbol}` : "Close Partial"}
        </button>
      </form>
    </div>
  );
}
