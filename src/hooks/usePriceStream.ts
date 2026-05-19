"use client";
import { useState, useEffect } from "react";

export function usePriceStream(symbols: string[]): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>({});

  // Stable key so the effect only re-runs when the symbol set actually changes.
  const symbolsKey = symbols.slice().sort().join(",");

  useEffect(() => {
    if (!symbolsKey) return;

    const es = new EventSource(`/api/stream?symbols=${symbolsKey}`);

    es.onmessage = (e: MessageEvent<string>) => {
      const { symbol, price } = JSON.parse(e.data) as { symbol: string; price: number };
      setPrices(prev => ({ ...prev, [symbol]: price }));
    };

    // EventSource reconnects automatically on error — no manual handling needed.
    return () => es.close();
  }, [symbolsKey]);

  return prices;
}
