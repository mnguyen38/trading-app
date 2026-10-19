// Typed Alpaca paper Trading API client.
// One instance per trader. Read keys from env at request time so .env reloads work in dev.

import type { Trader } from "./traders";

const BASE = process.env.ALPACA_TRADING_BASE_URL ?? "https://paper-api.alpaca.markets/v2";
const DATA_BASE = "https://data.alpaca.markets/v2";
const OPTIONS_DATA_BASE = "https://data.alpaca.markets/v1beta1";

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
  // Separate, smaller pool than buying_power — the actual ceiling for every options order
  // regardless of margin/equity elsewhere in the account. A cash-secured put's collateral
  // (strike × 100) or a credit spread's max loss draws from THIS, not equity%.
  options_buying_power: string;
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
  // Populated for order_class "mleg" (e.g. a credit spread) — the top-level `symbol` on a
  // multi-leg order is empty/blank (confirmed via Alpaca forum reports of this exact
  // behavior), so any code that needs a multi-leg order's actual option symbols must read
  // them from here, per leg, instead.
  legs?: Order[] | null;
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

// One NYSE trading day. Holidays are simply absent; early-close days are present.
export type CalendarDay = { date: string; open: string; close: string };

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

export type OptionSnapshot = {
  latestQuote?: { ap: number; bp: number; as: number; bs: number; t: string };
  latestTrade?: { p: number; s: number; t: string };
};

export type PlaceOptionOrderInput = {
  symbol: string;       // full contract symbol e.g. "AAPL250117C00150000"
  side: "buy" | "sell";
  type: "market" | "limit";
  time_in_force: "day" | "gtc";
  qty: string;          // number of contracts (each = 100 shares)
  limit_price?: string;
  client_order_id?: string;
};

// One leg of a multi-leg ("mleg") options order — e.g. the two legs of a credit call
// spread. position_intent tells Alpaca's risk engine whether this leg OPENS or CLOSES a
// position, which is what lets a short leg be accepted as "covered by the other leg in
// this same order" rather than rejected as a naked short.
export type OptionLeg = {
  symbol: string;
  ratio_qty: string;    // relative size vs the other legs — "1" for a simple 1:1 vertical
  side: "buy" | "sell";
  position_intent: "buy_to_open" | "sell_to_open" | "buy_to_close" | "sell_to_close";
};

export type PlaceMultiLegOrderInput = {
  legs: OptionLeg[];
  qty: string;
  type: "market" | "limit";
  limit_price?: string; // net price for the WHOLE combo (net credit/debit), not per-leg
  time_in_force: "day" | "gtc";
  client_order_id?: string;
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
    // nested=true rolls a multi-leg order's individual legs under its `legs` field — without
    // it, an mleg order's leg symbols aren't retrievable at all (its own top-level `symbol`
    // is blank).
    return this.req<Order[]>(BASE, "GET", `/orders?status=${status}&limit=${limit}&nested=true`);
  }
  getOrder(id: string) { return this.req<Order>(BASE, "GET", `/orders/${id}`); }
  // Alpaca's lookup-by-client-order-id endpoint — used to recover the real order (and its
  // server-assigned id/symbol) after a duplicate client_order_id rejection, so a retried
  // placement that actually succeeded the first time still gets tagged/tracked instead of
  // being silently skipped and left invisible to exit management.
  getOrderByClientId(clientOrderId: string) {
    return this.req<Order>(BASE, "GET", `/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`);
  }
  placeOrder(input: PlaceOrderInput) { return this.req<Order>(BASE, "POST", "/orders", input); }
  cancelOrder(id: string) { return this.req<void>(BASE, "DELETE", `/orders/${id}`); }
  cancelAllOrders() { return this.req<unknown[]>(BASE, "DELETE", "/orders"); }
  closePosition(symbol: string, qty?: string, percentage?: string) {
    const params = qty ? `?qty=${qty}` : percentage ? `?percentage=${percentage}` : "";
    return this.req<Order>(BASE, "DELETE", `/positions/${encodeURIComponent(symbol)}${params}`);
  }
  getPosition(symbol: string) { return this.req<Position>(BASE, "GET", `/positions/${encodeURIComponent(symbol)}`); }
  getClock() { return this.req<Clock>(BASE, "GET", "/clock"); }
  getCalendar(start: string, end: string) {
    return this.req<CalendarDay[]>(BASE, "GET", `/calendar?start=${start}&end=${end}`);
  }

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

  getOptionsSnapshots(symbols: string[], feed = "indicative") {
    if (symbols.length === 0) return Promise.resolve({ snapshots: {} as Record<string, OptionSnapshot> });
    const params = new URLSearchParams({ symbols: symbols.join(","), feed });
    return this.req<{ snapshots: Record<string, OptionSnapshot> }>(
      OPTIONS_DATA_BASE, "GET", `/options/snapshots?${params}`,
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
      ...(input.client_order_id ? { client_order_id: input.client_order_id } : {}),
      asset_class: "us_option",
      order_class: "simple",
    });
  }

  // A multi-leg ("mleg") options order — e.g. a credit call spread (sell near strike + buy
  // a further-OTM strike, same expiry). Alpaca only accepts an mleg order if every leg is
  // covered WITHIN the same order (confirmed via Alpaca's options-level-3 docs); it fills
  // or rejects the whole combo atomically — there is no partial-leg state to reconcile the
  // way there is when a straddle is placed as two separate `simple` orders.
  placeMultiLegOrder(input: PlaceMultiLegOrderInput) {
    return this.req<Order>(BASE, "POST", "/orders", {
      order_class: "mleg",
      qty: input.qty,
      type: input.type,
      time_in_force: input.time_in_force,
      ...(input.limit_price ? { limit_price: input.limit_price } : {}),
      ...(input.client_order_id ? { client_order_id: input.client_order_id } : {}),
      legs: input.legs,
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
  async getBars(symbol: string, timeframe = "1Day", limit = 260) {
    // Without a start date Alpaca returns only the current session bar.
    // 1.5× calendar days per trading day covers weekends + holidays.
    const start = new Date();
    start.setDate(start.getDate() - Math.ceil(limit * 1.5));
    const params = new URLSearchParams({
      timeframe,
      limit: String(limit),
      start: start.toISOString().split("T")[0],
      // Without this, Alpaca defaults to ascending order, so a `limit` cap returns
      // the OLDEST `limit` bars in the [start, now) window, not the most recent —
      // every indicator in this codebase was silently computing off week-old data.
      // Fetch newest-first (capped at `limit`), then restore chronological order below.
      sort: "desc",
      feed: "iex",
      adjustment: "split",
    });
    const res = await this.req<{ bars: Bar[] }>(
      DATA_BASE, "GET", `/stocks/${encodeURIComponent(symbol)}/bars?${params}`,
    );
    // Every caller (indicators.ts, signals.ts) assumes ascending/chronological order
    // with the most recent bar last — restore that after the desc fetch above.
    return { bars: [...res.bars].reverse() };
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
