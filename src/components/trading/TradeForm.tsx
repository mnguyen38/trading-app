"use client";
import { useState } from "react";
import { placeOrder } from "@/src/server/actions/trade";
import { money } from "@/src/lib/format";

type OrderType = "market" | "limit" | "stop" | "stop_limit";

const ORDER_LABELS: Record<OrderType, string> = {
  market: "Market",
  limit: "Limit",
  stop: "Stop",
  stop_limit: "Stop-Limit",
};

type Props = {
  symbol: string;
  price: number | null;
  buyingPower: number;
  error?: string;
};

export function TradeForm({ symbol, price, buyingPower, error }: Props) {
  const [side, setSide]           = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [qtyMode, setQtyMode]     = useState<"shares" | "notional">("shares");
  const [tif, setTif]             = useState<"day" | "gtc">("day");

  const needsLimit = orderType === "limit" || orderType === "stop_limit";
  const needsStop  = orderType === "stop"  || orderType === "stop_limit";

  return (
    <form action={placeOrder} className="flex flex-col gap-4">
      <input type="hidden" name="symbol" value={symbol} />
      <input type="hidden" name="side" value={side} />
      <input type="hidden" name="type" value={orderType} />
      <input type="hidden" name="tif" value={tif} />
      <input type="hidden" name="qty_mode" value={qtyMode} />

      {/* BUY / SELL */}
      <div className="grid grid-cols-2 gap-2">
        {(["buy", "sell"] as const).map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`rounded-lg py-3 text-sm font-semibold transition ${
              side === s
                ? s === "buy" ? "bg-green-500 text-white" : "bg-red-500 text-white"
                : "border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
            }`}
          >
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      {/* Order type */}
      <div className="grid grid-cols-4 gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
        {(Object.keys(ORDER_LABELS) as OrderType[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setOrderType(t)}
            className={`rounded-md py-1.5 text-xs font-medium transition ${
              orderType === t
                ? "bg-neutral-700 text-white"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {ORDER_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Quantity */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs text-neutral-500">Quantity</label>
          <div className="flex overflow-hidden rounded-md border border-neutral-800 text-xs">
            {(["shares", "notional"] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setQtyMode(m)}
                className={`px-2.5 py-1 transition ${
                  qtyMode === m ? "bg-neutral-700 text-white" : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {m === "shares" ? "Shares" : "Dollars"}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          {qtyMode === "notional" && (
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500">$</span>
          )}
          <input
            type="number"
            name="qty_value"
            min="0.01"
            step="any"
            required
            placeholder="0"
            className={`w-full rounded-lg border border-neutral-700 bg-neutral-900 py-3 pr-4 font-mono text-base text-right focus:border-orange-400/60 focus:outline-none ${
              qtyMode === "notional" ? "pl-8" : "pl-4"
            }`}
          />
        </div>
      </div>

      {/* Limit price */}
      {needsLimit && (
        <div>
          <label htmlFor="limit_price" className="mb-1.5 block text-xs text-neutral-500">Limit price</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500">$</span>
            <input
              id="limit_price"
              type="number"
              name="limit_price"
              min="0.01"
              step="0.01"
              defaultValue={price ?? undefined}
              required
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 py-3 pl-8 pr-4 font-mono text-base focus:border-orange-400/60 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Stop price */}
      {needsStop && (
        <div>
          <label htmlFor="stop_price" className="mb-1.5 block text-xs text-neutral-500">Stop price</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500">$</span>
            <input
              id="stop_price"
              type="number"
              name="stop_price"
              min="0.01"
              step="0.01"
              required
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 py-3 pl-8 pr-4 font-mono text-base focus:border-orange-400/60 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Time in force (not shown for market) */}
      {orderType !== "market" && (
        <div>
          <label className="mb-1.5 block text-xs text-neutral-500">Time in force</label>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
            {(["day", "gtc"] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTif(t)}
                className={`rounded-md py-1.5 text-xs font-medium transition ${
                  tif === t ? "bg-neutral-700 text-white" : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {t === "day" ? "Day" : "Good Till Cancelled"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Buying power */}
      <p className="text-xs text-neutral-600">
        Buying power: <span className="font-mono text-neutral-500">{money(buyingPower)}</span>
      </p>

      {/* Error */}
      {error && (
        <p className="rounded-lg bg-red-950 px-4 py-2 text-sm text-red-400">{error}</p>
      )}

      {/* Submit */}
      <button
        type="submit"
        className={`w-full rounded-lg py-3.5 text-sm font-semibold transition active:scale-[0.98] ${
          side === "buy"
            ? "bg-green-500 text-white hover:bg-green-400"
            : "bg-red-500 text-white hover:bg-red-400"
        }`}
      >
        Place {side === "buy" ? "Buy" : "Sell"} Order
      </button>
    </form>
  );
}
