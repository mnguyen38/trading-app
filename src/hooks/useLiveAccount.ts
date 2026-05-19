"use client";
import { useState, useEffect } from "react";
import type { Account, Position, Order } from "@/src/lib/alpaca";

export type LiveData = {
  account: Account;
  positions: Position[];
  openOrders: Order[];
  isOpen: boolean;
};

const POLL_MS = 10_000;

export function useLiveAccount(initial: LiveData): LiveData & { stale: boolean } {
  const [data, setData] = useState<LiveData>(initial);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/live");
        if (!res.ok) { setStale(true); return; }
        const json: LiveData = await res.json();
        if (!cancelled) { setData(json); setStale(false); }
      } catch {
        if (!cancelled) setStale(true);
      }
    }

    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return { ...data, stale };
}
