// Typed Alpaca paper Trading API client.
// One instance per trader. Read keys from env at request time so .env reloads work in dev.

import type { Trader } from "./traders";

const BASE = process.env.ALPACA_TRADING_BASE_URL ?? "https://paper-api.alpaca.markets/v2";
const DATA_BASE = "https://data.alpaca.markets/v2";

// ----- Types (just the fields we use; expand as needed) -----

export type Account = {
  account_number: string;
  status: string;
  cash: string;
  equity: string;
  buying_power: string;
  portfolio_value: string;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
};

export type Position = {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  side: "long" | "short";
};

export type OrderStatus =
  | "new" | "partially_filled" | "filled" | "done_for_day"
  | "canceled" | "expired" | "replaced" | "pending_cancel" | "pending_replace"
  | "accepted" | "pending_new" | "accepted_for_bidding" | "stopped"
  | "rejected" | "suspended" | "calculated";

export type Order = {
  id: string;
  client_order_id: string;
  symbol: string;
  qty: string | null;
  filled_qty: string;
  filled_avg_price: string | null;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";
  time_in_force: "day" | "gtc" | "opg" | "cls" | "ioc" | "fok";
  limit_price: string | null;
  stop_price: string | null;
  status: OrderStatus;
  submitted_at: string;
  filled_at: string | null;
  asset_class: string;
};

export type PlaceOrderInput = {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";
  time_in_force: "day" | "gtc" | "opg" | "cls" | "ioc" | "fok";
  qty?: string;
  notional?: string;
  limit_price?: string;
  stop_price?: string;
  trail_price?: string;
  trail_percent?: string;
  extended_hours?: boolean;
  client_order_id?: string;
  order_class?: "simple" | "bracket" | "oco" | "oto";
  take_profit?: { limit_price: string };
  stop_loss?: { stop_price: string; limit_price?: string };
};

export type Clock = {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
};

export type Bar = { t: string; o: number; h: number; l: number; c: number; v: number };

// ----- Client -----

export class AlpacaError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

class AlpacaClient {
  constructor(private key: string, private secret: string) {}

  private headers(): Record<string, string> {
    return {
      "APCA-API-KEY-ID": this.key,
      "APCA-API-SECRET-KEY": this.secret,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private async req<T>(host: string, method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${host}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (!res.ok) {
      const message = (parsed as { message?: string })?.message ?? `${method} ${path} -> ${res.status}`;
      throw new AlpacaError(res.status, parsed, message);
    }
    return parsed as T;
  }

  // Trading endpoints
  getAccount() { return this.req<Account>(BASE, "GET", "/account"); }
  getPositions() { return this.req<Position[]>(BASE, "GET", "/positions"); }
  getOrders(status: "open" | "closed" | "all" = "open", limit = 50) {
    return this.req<Order[]>(BASE, "GET", `/orders?status=${status}&limit=${limit}`);
  }
  getOrder(id: string) { return this.req<Order>(BASE, "GET", `/orders/${id}`); }
  placeOrder(input: PlaceOrderInput) { return this.req<Order>(BASE, "POST", "/orders", input); }
  cancelOrder(id: string) { return this.req<void>(BASE, "DELETE", `/orders/${id}`); }
  cancelAllOrders() { return this.req<unknown[]>(BASE, "DELETE", "/orders"); }
  closePosition(symbol: string, qty?: string, percentage?: string) {
    const params = qty ? `?qty=${qty}` : percentage ? `?percentage=${percentage}` : "";
    return this.req<Order>(BASE, "DELETE", `/positions/${encodeURIComponent(symbol)}${params}`);
  }
  getPosition(symbol: string) { return this.req<Position>(BASE, "GET", `/positions/${encodeURIComponent(symbol)}`); }
  getClock() { return this.req<Clock>(BASE, "GET", "/clock"); }

  // Market data (same auth, different host; IEX feed is free)
  getLatestQuote(symbol: string) {
    return this.req<{ quote: { ap: number; bp: number; as: number; bs: number; t: string } }>(
      DATA_BASE, "GET", `/stocks/${encodeURIComponent(symbol)}/quotes/latest?feed=iex`
    );
  }
  getSnapshot(symbol: string) {
    return this.req<{
      latestTrade?: { p: number };
      latestQuote?: { ap: number; bp: number };
      dailyBar?: { o: number; h: number; l: number; c: number; v: number };
      prevDailyBar?: { c: number };
    }>(DATA_BASE, "GET", `/stocks/${encodeURIComponent(symbol)}/snapshot?feed=iex`);
  }
  getBars(symbol: string, timeframe = "1Day", limit = 30) {
    return this.req<{ bars: Bar[] }>(
      DATA_BASE, "GET", `/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${timeframe}&limit=${limit}&feed=iex`
    );
  }
}

export function alpacaForTrader(trader: Trader): AlpacaClient {
  const key = process.env[`ALPACA_TRADING_KEY_ID_${trader.accountKey}`];
  const secret = process.env[`ALPACA_TRADING_SECRET_${trader.accountKey}`];
  if (!key || !secret) {
    throw new Error(`Missing ALPACA_TRADING_KEY_ID_${trader.accountKey} or ALPACA_TRADING_SECRET_${trader.accountKey} in .env`);
  }
  return new AlpacaClient(key, secret);
}
