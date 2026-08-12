"use client";
import { useState, useMemo } from "react";
import { placeOptionOrder } from "@/src/server/actions/options";
import { money } from "@/src/lib/format";
import type { OptionContract } from "@/src/lib/alpaca";
import type { Strategy } from "@/src/lib/strategies";

type Props = {
  underlying: string;
  contracts: OptionContract[];
  strategies: Strategy[];
  error?: string;
};

type ContractType = "call" | "put";

export function OptionsOrderForm({ underlying, contracts, strategies, error }: Props) {
  const [contractType, setContractType] = useState<ContractType>("call");
  const [expiry, setExpiry] = useState<string>("");
  const [strike, setStrike] = useState<string>("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [tif, setTif] = useState<"day" | "gtc">("day");

  // Available expiry dates for the selected call/put type
  const expiryDates = useMemo(() => {
    const dates = [...new Set(
      contracts.filter(c => c.type === contractType).map(c => c.expiration_date)
    )].sort();
    if (dates.length > 0 && !expiry) setTimeout(() => setExpiry(dates[0]), 0);
    return dates;
  }, [contracts, contractType]);

  // Available strikes for selected type + expiry
  const strikesForExpiry = useMemo(() => {
    return contracts
      .filter(c => c.type === contractType && c.expiration_date === expiry)
      .sort((a, b) => parseFloat(a.strike_price) - parseFloat(b.strike_price));
  }, [contracts, contractType, expiry]);

  const selectedContract = strikesForExpiry.find(c => c.strike_price === strike);

  const handleTypeChange = (t: ContractType) => {
    setContractType(t);
    setExpiry("");
    setStrike("");
  };

  const handleExpiryChange = (d: string) => {
    setExpiry(d);
    setStrike("");
  };

  const noContracts = contracts.length === 0;

  return (
    <form action={placeOptionOrder} className="flex flex-col gap-4">
      <input type="hidden" name="underlying_symbol" value={underlying} />
      <input type="hidden" name="contract_symbol" value={selectedContract?.symbol ?? ""} />
      <input type="hidden" name="side" value={side} />
      <input type="hidden" name="type" value={orderType} />
      <input type="hidden" name="tif" value={tif} />

      {noContracts ? (
        <div className="rounded-lg border border-neutral-800 p-4 text-center text-sm text-neutral-500">
          No option contracts available for {underlying}. Try a large-cap stock like AAPL or TSLA.
        </div>
      ) : (
        <>
          {/* Call / Put toggle */}
          <div className="grid grid-cols-2 gap-2">
            {(["call", "put"] as ContractType[]).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => handleTypeChange(t)}
                className={`rounded-lg py-2.5 text-sm font-semibold transition ${
                  contractType === t
                    ? t === "call" ? "bg-sky-500 text-white" : "bg-violet-500 text-white"
                    : "border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
                }`}
              >
                {t === "call" ? "Call ↑" : "Put ↓"}
              </button>
            ))}
          </div>

          {/* Expiry picker */}
          <div>
            <label className="mb-1.5 block text-xs text-neutral-500">Expiration date</label>
            <select
              value={expiry}
              onChange={e => handleExpiryChange(e.target.value)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm focus:border-orange-400/60 focus:outline-none"
            >
              <option value="">Select expiry…</option>
              {expiryDates.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {/* Strike picker */}
          {expiry && (
            <div>
              <label className="mb-1.5 block text-xs text-neutral-500">Strike price</label>
              <select
                value={strike}
                onChange={e => setStrike(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm focus:border-orange-400/60 focus:outline-none"
              >
                <option value="">Select strike…</option>
                {strikesForExpiry.map(c => (
                  <option key={c.symbol} value={c.strike_price}>
                    {money(parseFloat(c.strike_price))}
                    {c.close_price ? ` · last ${money(parseFloat(c.close_price))}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Selected contract summary */}
          {selectedContract && (
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-3 text-xs text-neutral-400">
              <span className="font-mono text-neutral-300">{selectedContract.symbol}</span>
              <span className="ml-2 text-neutral-600">· each contract = 100 shares</span>
              {selectedContract.close_price && (
                <div className="mt-1">Last price: <span className="font-mono text-neutral-300">{money(parseFloat(selectedContract.close_price))}</span> per contract</div>
              )}
            </div>
          )}

          {/* Buy / Sell */}
          <div className="grid grid-cols-2 gap-2">
            {(["buy", "sell"] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={`rounded-lg py-3 text-sm font-semibold transition ${
                  side === s
                    ? s === "buy" ? "bg-green-500 text-white" : "bg-red-500 text-white"
                    : "border border-neutral-700 text-neutral-400 hover:border-neutral-500"
                }`}
              >
                {s === "buy" ? "Buy" : "Sell"}
              </button>
            ))}
          </div>

          {/* Quantity */}
          <div>
            <label className="mb-1.5 block text-xs text-neutral-500">Contracts (1 contract = 100 shares)</label>
            <input
              type="number"
              name="qty"
              min="1"
              step="1"
              required
              placeholder="1"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 font-mono text-base focus:border-orange-400/60 focus:outline-none"
            />
          </div>

          {/* Order type */}
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
            {(["market", "limit"] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setOrderType(t)}
                className={`rounded-md py-1.5 text-xs font-medium transition ${
                  orderType === t ? "bg-neutral-700 text-white" : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {t === "market" ? "Market" : "Limit"}
              </button>
            ))}
          </div>

          {/* Limit price */}
          {orderType === "limit" && (
            <div>
              <label className="mb-1.5 block text-xs text-neutral-500">Limit price (per contract)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500">$</span>
                <input
                  type="number"
                  name="limit_price"
                  min="0.01"
                  step="0.01"
                  required
                  defaultValue={selectedContract?.close_price ?? undefined}
                  className="w-full rounded-lg border border-neutral-700 bg-neutral-900 py-3 pl-8 pr-4 font-mono text-base focus:border-orange-400/60 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Time in force (only for limit) */}
          {orderType === "limit" && (
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

          {/* Strategy tag */}
          {strategies.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs text-neutral-500">Tag to strategy (optional)</label>
              <select
                name="strategy_slug"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm focus:border-orange-400/60 focus:outline-none"
              >
                <option value="">— No strategy —</option>
                {strategies.map(s => (
                  <option key={s.slug} value={s.slug}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      {/* Error */}
      {error && (
        <p className="rounded-lg bg-red-950 px-4 py-2 text-sm text-red-400">{error}</p>
      )}

      {/* Submit */}
      {!noContracts && (
        <button
          type="submit"
          disabled={!selectedContract}
          className={`w-full rounded-lg py-3.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-40 ${
            side === "buy"
              ? "bg-green-500 text-white hover:bg-green-400"
              : "bg-red-500 text-white hover:bg-red-400"
          }`}
        >
          {selectedContract
            ? `Place ${side === "buy" ? "Buy" : "Sell"} Order`
            : "Select a contract above"}
        </button>
      )}
    </form>
  );
}
