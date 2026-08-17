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
  asset_class?: string;
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

// ----- Options types -----

export type OptionContract = {
  id: string;
  symbol: string;             // e.g. "AAPL250117C00150000"
  underlying_symbol: string;  // e.g. "AAPL"
  type: "call" | "put";
  expiration_date: string;    // "2025-01-17"
  strike_price: string;       // "150.00"
  open_interest: string | null;
  close_price: string | null;
};

export type PlaceOptionOrderInput = {
  symbol: string;       // full contract symbol e.g. "AAPL250117C00150000"
  side: "buy" | "sell";
  type: "market" | "limit";
  time_in_force: "day" | "gtc";
  qty: string;          // number of contracts (each = 100 shares)
  limit_price?: string;
};

// Parsed representation of an OCC option symbol
export type ParsedOptionSymbol = {
  underlying: string;
  expiry: string;       // "2025-01-17"
  contractType: "call" | "put";
  strike: number;
};

export function parseOptionSymbol(symbol: string): ParsedOptionSymbol | null {
  const match = symbol.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
  if (!match) return null;
  const [, underlying, dateStr, typeChar, strikeStr] = match;
  const expiry = `20${dateStr.slice(0, 2)}-${dateStr.slice(2, 4)}-${dateStr.slice(4, 6)}`;
  const strike = parseInt(strikeStr, 10) / 1000;
  return { underlying, expiry, contractType: typeChar === "C" ? "call" : "put", strike };
}

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

export class AlpacaClient {
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

  // Options endpoints
  getOptionsContracts(
    underlying: string,
    opts: {
      type?: "call" | "put";
      expiration_date_gte?: string;
      expiration_date_lte?: string;
      strike_price_gte?: string;
      strike_price_lte?: string;
      limit?: number;
    } = {},
  ) {
    const params = new URLSearchParams({ underlying_symbols: underlying });
    if (opts.type) params.set("type", opts.type);
    if (opts.expiration_date_gte) params.set("expiration_date_gte", opts.expiration_date_gte);
    if (opts.expiration_date_lte) params.set("expiration_date_lte", opts.expiration_date_lte);
    if (opts.strike_price_gte) params.set("strike_price_gte", opts.strike_price_gte);
    if (opts.strike_price_lte) params.set("strike_price_lte", opts.strike_price_lte);
    params.set("limit", String(opts.limit ?? 100));
    return this.req<{ option_contracts: OptionContract[]; next_page_token: string | null }>(
      BASE, "GET", `/options/contracts?${params}`,
    );
  }

  placeOptionOrder(input: PlaceOptionOrderInput) {
    return this.req<Order>(BASE, "POST", "/orders", {
      symbol: input.symbol,
      side: input.side,
      type: input.type,
      time_in_force: input.time_in_force,
      qty: input.qty,
      ...(input.limit_price ? { limit_price: input.limit_price } : {}),
      asset_class: "us_option",
      order_class: "simple",
    });
  }

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
  getBars(symbol: string, timeframe = "1Day", limit = 260) {
    // Without a start date Alpaca returns only the current session bar.
    // 1.5× calendar days per trading day covers weekends + holidays.
    const start = new Date();
    start.setDate(start.getDate() - Math.ceil(limit * 1.5));
    const params = new URLSearchParams({
      timeframe,
      limit: String(limit),
      start: start.toISOString().split("T")[0],
      feed: "iex",
      adjustment: "split",
    });
    return this.req<{ bars: Bar[] }>(
      DATA_BASE, "GET", `/stocks/${encodeURIComponent(symbol)}/bars?${params}`,
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
