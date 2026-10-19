import type { AlpacaClient, Position, Bar } from "../alpaca";
import { parseOptionSymbol } from "../alpaca";
import { hv30, rsi, sma, monthReturn, quarterReturn, high52w, lastClose } from "./indicators";
import { estimateIV, selectStraddleContracts, selectShortPremiumStructure } from "./iv";
import { MICRO_UNIVERSE, MACRO_EQUITY_UNIVERSE_UNIQUE } from "./universe";

// ── Types ─────────────────────────────────────────────────────────────────────

// One leg of a multi-leg options order (e.g. a credit call spread's short + long legs).
// Only meaningful when OrderSpec.asset === "option_spread".
export type OrderSpecLeg = {
  symbol: string;
  side: "buy" | "sell";
  positionIntent: "buy_to_open" | "sell_to_open" | "buy_to_close" | "sell_to_close";
};

export type OrderSpec = {
  asset: "stock" | "option" | "option_spread";
  symbol: string;
  underlying: string;
  side: "buy" | "sell";
  qty: number;
  orderType: "market" | "bracket";
  takeProfitPrice?: number;
  stopLossPrice?: number;
  // Only for asset === "option_spread" — the real legs to place as one atomic mleg order.
  // `symbol`/`side` above still carry the SHORT leg's identity for logging/display.
  legs?: OrderSpecLeg[];
};

export type SignalFired = {
  strategySlug: string;
  underlying: string;
  reason: string;
  orders: OrderSpec[];
  // Applied immediately (even if no orders, or if the orders below fail) — e.g. the daily
  // streak increment/reset, which reflects market data observed THIS run and is correct
  // regardless of whether a trade happens to fire off the back of it.
  stateUpdates: { key: string; value: string }[];
  // Applied ONLY after every order in `orders` above is confirmed placed (or was already
  // placed by an earlier attempt, per the client_order_id idempotency check) — i.e. only
  // once the signal has actually been acted on. Use this for "consume the signal" updates
  // (e.g. resetting a streak counter to 0) that would otherwise be lost permanently if the
  // order failed to place: applying them unconditionally meant a failed order still reset
  // state as if the trade had happened, forcing the strategy to recount from scratch for no
  // reason.
  postOrderStateUpdates?: { key: string; value: string }[];
};

// Every signal function returns this — fired is null when no trade triggers.
// log[] always contains per-ticker diagnostic lines so the UI can show exactly
// why each candidate was accepted or rejected.
export type SignalResult = {
  fired: SignalFired | null;
  log: string[];
};

export type ExitFired = {
  positionSymbol: string;
  underlying: string;
  strategySlug: string;
  reason: string;
};

export type SignalContext = {
  alpaca: AlpacaClient;
  equity: number;
  perPositionBudget: number;
  // The actual Alpaca-reported ceiling for options collateral — a cash-secured put's
  // collateral (strike × 100) or a credit spread's max loss draws from this, NOT from
  // equity%. Every long-premium strategy in this file only risks the premium it pays, so
  // sizing off equity% was always a safe upper bound; a short-premium strategy risks up to
  // the full strike, so it needs this real number instead.
  optionsBuyingPower: number;
  positions: Position[];
  tags: { strategySlug: string; symbol: string; exactSymbol?: string | null }[];
  // Underlyings with a resting (unfilled) order for THIS strategy, attributed the same way
  // groupOptionPositions attributes a position — via exact-symbol tag match. Without this, a
  // signal re-scanning every 5 minutes sees a name whose limit order hasn't filled yet as
  // free (no position exists until it fills), and maxPositions doesn't count it either — the
  // strategy could keep placing MORE orders than its own cap on names that are just slow to
  // fill, piling up resting orders that then all land at once.
  pendingOrderUnderlyings: Set<string>;
  stateMap: Map<string, string>;
  // Dynamic scanner shortlist — replaces static watchlists when present.
  // null means scanner hasn't run yet; fall back to built-in universe.
  microScanList: string[] | null;
  macroEquityList: string[] | null;
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function sk(slug: string, ticker: string, metric: string) {
  return `${slug}:${ticker}:${metric}`;
}

function stateInt(map: Map<string, string>, key: string): number {
  return parseInt(map.get(key) ?? "0", 10) || 0;
}

function stateStr(map: Map<string, string>, key: string): string {
  return map.get(key) ?? "";
}

// Defense-in-depth: if the last bar is unexpectedly old (API regression, data outage,
// a halted/delisted symbol), treat it as no data rather than silently computing every
// indicator off stale prices. 5 calendar days comfortably covers a 3-day weekend plus
// a holiday without flagging normal data as stale.
const MAX_BAR_AGE_DAYS = 5;

async function bars(alpaca: AlpacaClient, symbol: string): Promise<Bar[]> {
  try {
    const res = await alpaca.getBars(symbol, "1Day", 260);
    const data = res.bars ?? [];
    const last = data.at(-1);
    if (last) {
      const ageDays = (Date.now() - new Date(last.t).getTime()) / 86_400_000;
      // Written as a rejected-unless-provably-fresh check, not `ageDays > MAX`: an invalid
      // timestamp makes ageDays NaN, and `NaN > 5` is false, so the original form let bad
      // data straight through instead of treating it as stale.
      if (!(ageDays <= MAX_BAR_AGE_DAYS)) {
        console.warn(`[engine] ${symbol}: last bar age is ${Number.isNaN(ageDays) ? "unparseable" : `${ageDays.toFixed(1)} days`} (${last.t}) — treating as stale, skipping`);
        return [];
      }
    }
    return data;
  } catch {
    return [];
  }
}

// Sizes an options trade to the strategy's perPositionBudget, but refuses to force a trade
// that would blow WAY past that budget just to satisfy "buy at least 1 unit" — e.g. a
// $1,000 perPositionBudget "buying" a single $1,800 straddle on an expensive underlying
// overshoots the strategy's own sizing discipline by 80%, not a rounding nicety. Returns
// null (skip this candidate) when even 1 unit exceeds the budget by more than the
// tolerance; otherwise always returns at least 1 (a cheap-enough single unit is fine to
// round up for).
export function sizeWithinBudget(budget: number, unitCost: number, maxOverBudgetFraction = 0.25): number | null {
  if (!(unitCost > 0) || !(budget > 0)) return null;
  const qty = Math.floor(budget / unitCost);
  if (qty >= 1) return qty;
  const overBudgetFraction = (unitCost - budget) / budget;
  return overBudgetFraction <= maxOverBudgetFraction ? 1 : null;
}

// The underlying ticker for a position — the position symbol itself for stock, the parsed
// underlying for an option contract. Exported so runner.ts's own position-counting logic
// (activePositionsFor, maxPositions checks) uses the same exact-match rule as everything
// here, instead of its own prefix check.
//
// Previously both this file and runner.ts matched a strategy's tagged ticker against a
// position's symbol with sym.startsWith(tag) — meant to match an option contract's full
// OCC symbol (e.g. "COST260117C00900000") against its bare underlying tag ("COST"), but a
// SHORT tag is a prefix of many unrelated tickers: "C" (Citigroup) matches every COST, CRM,
// CRWD, CVX and COP position too, silently attributing other strategies' or other
// underlyings' positions to the wrong strategy's maxPositions count and "busy" set.
export function positionUnderlying(symbol: string): string {
  return parseOptionSymbol(symbol)?.underlying ?? symbol;
}

function activeUnderlyings(
  slug: string,
  tags: SignalContext["tags"],
  positions: Position[],
  pendingOrderUnderlyings: Set<string> = new Set(),
): Set<string> {
  // Exact-symbol match first (same lookup groupOptionPositions uses), falling back to the
  // old underlying-only match only for legacy (exactSymbol-less) tag rows. A pure
  // underlying-string match (the old behavior here) could mark a position as "held by
  // strategy A" just because A has ANY historical tag for the same underlying, even when
  // the position was actually opened by a different strategy B.
  const active = new Set<string>();
  for (const p of positions) {
    const underlying = positionUnderlying(p.symbol).toUpperCase();
    const exactTag = tags.find(t => t.exactSymbol === p.symbol);
    const tag = exactTag ?? tags.find(t => !t.exactSymbol && t.symbol.toUpperCase() === underlying);
    if (tag?.strategySlug === slug) active.add(underlying);
  }
  // pendingOrderUnderlyings is already attributed to this specific strategy by the caller
  // (runner.ts, via the same exact-symbol-first lookup on the open order).
  for (const u of pendingOrderUnderlyings) active.add(u);
  return active;
}

// ── Watchlists ────────────────────────────────────────────────────────────────
// Sector/cycle ETFs are fixed — the scanner doesn't change these.
// Equity lists fall back to these if the scanner cache is empty.

const SECTOR_ETFS   = ["XLK", "XLE", "XLF", "XLV", "XLI", "XLP", "XLU", "XLY", "XLRE", "XLC", "XLB"];
const CYCLE_TICKERS = ["SPY", "TLT", "XLK", "XLP", "XLU", "XLI", "XLY", "XLF"];

// ── Micro: Vol-Spread Long ────────────────────────────────────────────────────
// Goyal & Saretto 2009: long straddle when IV < HV30.

export async function signalVolSpreadLong(ctx: SignalContext): Promise<SignalResult> {
  const slug = "vol-spread-long";
  const log: string[] = [];
  const universe = ctx.microScanList ?? MICRO_UNIVERSE;
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions, ctx.pendingOrderUnderlyings);
  const scan = universe.filter(t => !busy.has(t));

  if (!scan.length) {
    return { fired: null, log: [`All ${universe.length} candidates already held — at max positions`] };
  }

  log.push(`Scanning ${scan.length} candidates (${ctx.microScanList ? "scanner" : "fallback"} list)`);
  const allBars = await Promise.allSettled(scan.map(t => bars(ctx.alpaca, t)));

  for (let i = 0; i < scan.length; i++) {
    const sym = scan[i];
    const b = allBars[i];

    if (b.status !== "fulfilled" || b.value.length < 31) {
      log.push(`${sym}: only ${b.status === "fulfilled" ? b.value.length : 0} bars — need 31+ for HV30`);
      continue;
    }

    const hv = hv30(b.value);
    const price = lastClose(b.value);
    if (isNaN(hv) || !price) {
      log.push(`${sym}: could not compute HV30 or price`);
      continue;
    }

    const ivEst = await estimateIV(ctx.alpaca, sym, price);
    if (!ivEst) {
      log.push(`${sym}: HV30 ${hv.toFixed(1)}% — could not estimate IV (no ATM contracts)`);
      continue;
    }

    if (ivEst.iv >= hv) {
      log.push(`${sym}: IV ${ivEst.iv.toFixed(1)}% ≥ HV30 ${hv.toFixed(1)}% — vol not underpriced, skip`);
      continue;
    }

    const straddle = await selectStraddleContracts(ctx.alpaca, sym, price);
    if (!straddle) {
      log.push(`${sym}: IV ${ivEst.iv.toFixed(1)}% < HV30 ${hv.toFixed(1)}% ✓ but no ATM straddle contracts available`);
      continue;
    }

    const straddleCost = ivEst.straddle * 100;
    const qty = sizeWithinBudget(ctx.perPositionBudget, straddleCost);
    if (qty === null) {
      log.push(`${sym}: IV ${ivEst.iv.toFixed(1)}% < HV30 ${hv.toFixed(1)}% ✓ but straddle cost $${straddleCost.toFixed(0)} is too far over the $${ctx.perPositionBudget.toFixed(0)} budget — skip`);
      continue;
    }
    const reason = `${sym}: IV ${ivEst.iv.toFixed(1)}% < HV30 ${hv.toFixed(1)}% — straddle underpriced, buying ${qty}× ATM straddle`;
    log.push(`${sym}: ✓ SIGNAL — ${reason}`);

    return {
      fired: {
        strategySlug: slug, underlying: sym, reason,
        orders: [
          { asset: "option", symbol: straddle.callSymbol, underlying: sym, side: "buy", qty, orderType: "market" },
          { asset: "option", symbol: straddle.putSymbol,  underlying: sym, side: "buy", qty, orderType: "market" },
        ],
        stateUpdates: [],
      },
      log,
    };
  }

  return { fired: null, log };
}

// ── Micro: RSI Reversal ───────────────────────────────────────────────────────
// Mean reversion in equity prices is well-documented (Poterba & Summers 1988,
// De Bondt & Thaler 1985). RSI was developed by Welles Wilder (1978) as a practical
// implementation of momentum reversal. Buy a call when RSI(14) < 30 (oversold, expect
// a bounce) or a put when RSI(14) > 70 (overbought, expect a fade) — an ATM near-term
// option concentrates the bet with defined risk (max loss = premium paid).
//
// Slug stays "vrp-premium-seller" for backward compatibility with existing
// strategy_trades rows and engine_state — only the signal logic changed.

export async function signalRsiReversal(ctx: SignalContext): Promise<SignalResult> {
  const slug = "vrp-premium-seller";
  const log: string[] = [];
  const universe = ctx.microScanList ?? MICRO_UNIVERSE;
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions, ctx.pendingOrderUnderlyings);
  const scan = universe.filter(t => !busy.has(t));

  if (!scan.length) {
    return { fired: null, log: [`All ${universe.length} candidates already held — at max positions`] };
  }
  log.push(`Scanning ${scan.length} candidates (${ctx.microScanList ? "scanner" : "fallback"} list)`);

  const allBars = await Promise.allSettled(scan.map(t => bars(ctx.alpaca, t)));

  for (let i = 0; i < scan.length; i++) {
    const sym = scan[i];
    const b = allBars[i];

    if (b.status !== "fulfilled" || b.value.length < 15) {
      log.push(`${sym}: only ${b.status === "fulfilled" ? b.value.length : 0} bars — need 15+ for RSI(14)`);
      continue;
    }

    const closes = b.value.map(bar => bar.c);
    const price = lastClose(b.value);
    const rsiVal = rsi(closes, 14);
    if (!price || isNaN(rsiVal)) {
      log.push(`${sym}: could not compute price or RSI`);
      continue;
    }

    if (rsiVal >= 30 && rsiVal <= 70) {
      log.push(`${sym}: RSI ${rsiVal.toFixed(0)} — not extreme (need <30 oversold or >70 overbought)`);
      continue;
    }

    const bullish = rsiVal < 30;
    const [ivEst, straddle] = await Promise.all([
      estimateIV(ctx.alpaca, sym, price),
      selectStraddleContracts(ctx.alpaca, sym, price),
    ]);
    if (!straddle) {
      log.push(`${sym}: RSI ${rsiVal.toFixed(0)} ${bullish ? "oversold" : "overbought"} ✓ but no ATM contracts available`);
      continue;
    }

    const contractSym = bullish ? straddle.callSymbol : straddle.putSymbol;
    // Per-leg premium isn't separately available — approximate with the full
    // straddle (call+put) cost, same conservative sizing signalVrpInversionLong uses.
    const legCost = ivEst ? ivEst.straddle * 100 : price * 0.03 * 100;
    const qty = sizeWithinBudget(ctx.perPositionBudget, legCost);
    if (qty === null) {
      log.push(`${sym}: RSI ${rsiVal.toFixed(0)} ${bullish ? "oversold" : "overbought"} ✓ but est. cost $${legCost.toFixed(0)} is too far over the $${ctx.perPositionBudget.toFixed(0)} budget — skip`);
      continue;
    }
    const reason = bullish
      ? `${sym}: RSI ${rsiVal.toFixed(0)} oversold — buying ATM call expecting a bounce`
      : `${sym}: RSI ${rsiVal.toFixed(0)} overbought — buying ATM put expecting a fade`;
    log.push(`${sym}: ✓ SIGNAL — ${reason}`);

    return {
      fired: {
        strategySlug: slug, underlying: sym, reason,
        orders: [{ asset: "option", symbol: contractSym, underlying: sym, side: "buy", qty, orderType: "market" }],
        stateUpdates: [],
      },
      log,
    };
  }

  return { fired: null, log };
}

// ── Micro: VRP Premium Short ──────────────────────────────────────────────────
// Dew-Becker & Giglio: IV exceeds HV on ~85% of trading days — the "normal" side of the
// variance risk premium. Every OTHER micro strategy in this file is long premium
// (vol-spread-long, vrp-premium-seller, vrp-inversion-long all profit only when vol or
// price moves in their favor); the far more common "sell rich premium" side of the exact
// same edge was entirely unrepresented. vrp-inversion-long's own risk note already says
// "This signal is also your cue to CLOSE any active short-vol positions" — implying a
// short-vol sleeve was always meant to exist alongside it. This is it.
//
// Both legs here are COVERED without ever buying the underlying stock:
//   - SPY above its 50MA (bullish-leaning tape): sell a cash-secured put. Collateral is
//     strike × 100 in cash (Alpaca options level 1) — never requires owning a share.
//   - SPY below its 50MA (bearish-leaning tape): sell a credit call spread (sell the near
//     strike, buy a further-OTM "wing" same expiry, Alpaca options level 3). The wing caps
//     the combo's max loss at the strike width, which is what lets the short call be sold
//     without owning stock — a bare short call isn't offered at any level on Alpaca.
// This is deliberately NOT the old covered-call construction (buy 100 shares + sell a
// call) that left the micro account holding ~$118k of single-name equity positions.
//
// Replaces earnings-iv-crush's slot — that strategy's own thesis text admitted it loses
// on average (sellers collect the IV crush, not buyers); this is the actual positive-EV
// side of selling premium instead.

export async function signalVrpPremiumShort(ctx: SignalContext): Promise<SignalResult> {
  const slug = "vrp-premium-short";
  const log: string[] = [];
  const universe = ctx.microScanList ?? MICRO_UNIVERSE;
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions, ctx.pendingOrderUnderlyings);
  const scan = universe.filter(t => !busy.has(t));

  if (!scan.length) {
    return { fired: null, log: [`All ${universe.length} candidates already held — at max positions`] };
  }
  log.push(`Scanning ${scan.length} candidates (${ctx.microScanList ? "scanner" : "fallback"} list)`);

  const spyBars = await bars(ctx.alpaca, "SPY");
  const spyAbove50 = lastClose(spyBars) > sma(spyBars.map(b => b.c), 50);
  log.push(`SPY direction: ${spyAbove50 ? "above" : "below"} 50MA → selling ${spyAbove50 ? "cash-secured puts" : "credit call spreads"} (both covered, no stock required)`);

  const scanNoSpy = scan.filter(t => t !== "SPY");
  const allBars = await Promise.allSettled(scanNoSpy.map(t => bars(ctx.alpaca, t)));

  for (let i = 0; i < scanNoSpy.length; i++) {
    const sym = scanNoSpy[i];
    const b = allBars[i];

    if (b.status !== "fulfilled" || b.value.length < 31) {
      log.push(`${sym}: only ${b.status === "fulfilled" ? b.value.length : 0} bars — need 31+ for HV30`);
      continue;
    }

    const hv = hv30(b.value);
    const price = lastClose(b.value);
    if (isNaN(hv) || !price) {
      log.push(`${sym}: could not compute HV30 or price`);
      continue;
    }

    const ivEst = await estimateIV(ctx.alpaca, sym, price);
    if (!ivEst) {
      log.push(`${sym}: HV30 ${hv.toFixed(1)}% — could not estimate IV (no ATM contracts)`);
      continue;
    }

    if (ivEst.iv < hv) {
      log.push(`${sym}: IV ${ivEst.iv.toFixed(1)}% < HV30 ${hv.toFixed(1)}% — vol not rich enough to sell, skip`);
      continue;
    }

    const structure = await selectShortPremiumStructure(ctx.alpaca, sym, price, ivEst.iv);
    if (!structure) {
      log.push(`${sym}: IV ${ivEst.iv.toFixed(1)}% ≥ HV30 ${hv.toFixed(1)}% ✓ but no usable strikes for a covered short structure`);
      continue;
    }

    // Collateral-based sizing, not premium-based — a cash-secured put's collateral is the
    // FULL strike × 100, not the small premium received, and a credit spread's max loss is
    // the strike width × 100. Reusing sizeWithinBudget's "round up to 1 even ~25% over
    // budget" escape hatch here would be dangerous (a $17,500 CSP against a $5,800 slot is
    // 3x over, not a rounding nicety) — so this sizes directly off the real risk and skips
    // entirely rather than overriding, and caps against the account's actual options buying
    // power, not just this strategy's equity%-based slot budget.
    const collateralPerContract = spyAbove50
      ? structure.shortPutStrike * 100
      : (structure.longCallStrike - structure.shortCallStrike) * 100;
    const availableBudget = Math.min(ctx.perPositionBudget, ctx.optionsBuyingPower);
    const qty = Math.floor(availableBudget / collateralPerContract);
    if (qty < 1) {
      log.push(`${sym}: IV ${ivEst.iv.toFixed(1)}% ≥ HV30 ${hv.toFixed(1)}% ✓ but $${collateralPerContract.toFixed(0)} collateral exceeds the $${availableBudget.toFixed(0)} available budget — skip`);
      continue;
    }

    if (spyAbove50) {
      const reason = `${sym}: IV ${ivEst.iv.toFixed(1)}% ≥ HV30 ${hv.toFixed(1)}% — selling ${qty}× cash-secured put, strike $${structure.shortPutStrike} (SPY ↑ 50MA)`;
      log.push(`${sym}: ✓ SIGNAL — ${reason}`);
      return {
        fired: {
          strategySlug: slug, underlying: sym, reason,
          orders: [
            { asset: "option", symbol: structure.shortPutSymbol, underlying: sym, side: "sell", qty, orderType: "market" },
          ],
          stateUpdates: [],
        },
        log,
      };
    }

    const reason = `${sym}: IV ${ivEst.iv.toFixed(1)}% ≥ HV30 ${hv.toFixed(1)}% — selling ${qty}× credit call spread $${structure.shortCallStrike}/$${structure.longCallStrike} (SPY ↓ 50MA)`;
    log.push(`${sym}: ✓ SIGNAL — ${reason}`);
    return {
      fired: {
        strategySlug: slug, underlying: sym, reason,
        orders: [
          {
            asset: "option_spread", symbol: structure.shortCallSymbol, underlying: sym, side: "sell", qty, orderType: "market",
            legs: [
              { symbol: structure.shortCallSymbol, side: "sell", positionIntent: "sell_to_open" },
              { symbol: structure.longCallSymbol,  side: "buy",  positionIntent: "buy_to_open" },
            ],
          },
        ],
        stateUpdates: [],
      },
      log,
    };
  }

  return { fired: null, log };
}

// ── Micro: VRP Inversion Long ─────────────────────────────────────────────────
// Dew-Becker & Giglio: buy directional options when HV > IV for 3+ sessions.

export async function signalVrpInversionLong(ctx: SignalContext): Promise<SignalResult> {
  const slug = "vrp-inversion-long";
  const log: string[] = [];
  const universe = ctx.microScanList ?? MICRO_UNIVERSE;
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions, ctx.pendingOrderUnderlyings);
  const scan = universe.filter(t => !busy.has(t));

  if (!scan.length) {
    return { fired: null, log: [`All ${universe.length} candidates already held — at max positions`] };
  }
  log.push(`Scanning ${scan.length} candidates (${ctx.microScanList ? "scanner" : "fallback"} list)`);

  const spyBars = await bars(ctx.alpaca, "SPY");
  const spyCloses = spyBars.map(b => b.c);
  const spyAbove50 = lastClose(spyBars) > sma(spyCloses, 50);
  log.push(`SPY direction: ${spyAbove50 ? "above" : "below"} 50MA → favoring ${spyAbove50 ? "calls" : "puts"}`);

  const scanNoSpy = scan.filter(t => t !== "SPY");
  const allBars = await Promise.allSettled(scanNoSpy.map(t => bars(ctx.alpaca, t)));

  // "3 CONSECUTIVE sessions" needs to be checked against the actual previous NYSE trading
  // session, not just "any earlier date" — without this, a symbol that gets skipped for a
  // few days (already busy, briefly dropped out of the scanner list, repeated IV fetch
  // failures) could still reach a 3-day streak across non-adjacent sessions, since the old
  // code only checked lastCountedDate !== today. null means the calendar fetch itself
  // failed — fall back to not enforcing adjacency that run rather than blocking the whole
  // strategy on an unrelated, likely-transient API issue.
  const todayISO = new Date().toISOString().slice(0, 10);
  let previousSessionISO: string | null = null;
  try {
    const start = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const cal = await ctx.alpaca.getCalendar(start, todayISO);
    const priorSessions = cal.map(d => d.date).filter(d => d < todayISO).sort();
    previousSessionISO = priorSessions.length ? priorSessions[priorSessions.length - 1] : null;
  } catch (e) {
    log.push(`Could not fetch trading calendar for streak-adjacency check: ${String(e)} — not enforcing this run`);
  }

  const stateUpdates: { key: string; value: string }[] = [];
  let tradeResult: SignalFired | null = null;

  for (let i = 0; i < scanNoSpy.length; i++) {
    const sym = scanNoSpy[i];
    const b = allBars[i];
    const barsData = b.status === "fulfilled" ? b.value : [];

    if (barsData.length < 31) {
      log.push(`${sym}: only ${barsData.length} bars — need 31+ for HV30`);
      continue;
    }

    const hv = hv30(barsData);
    const price = lastClose(barsData);
    if (isNaN(hv) || !price) {
      log.push(`${sym}: could not compute HV30 or price`);
      continue;
    }

    const ivEst = await estimateIV(ctx.alpaca, sym, price);
    const streakKey = sk(slug, sym, "streak");
    const dateKey = sk(slug, sym, "streak_date");
    const storedStreak = stateInt(ctx.stateMap, streakKey);
    const lastCountedDate = stateStr(ctx.stateMap, dateKey);
    // UTC calendar date as a once-per-trading-day gate. The entry cron fires every 5
    // minutes, and "3+ consecutive sessions" was previously 3 runs (~15 minutes) because
    // this counted on every run instead of once per day.
    const today = new Date().toISOString().slice(0, 10);

    // Only trust storedStreak if it was actually counted on the trading session right
    // before today (or we can't verify either way, or there's nothing to break yet) — a
    // streak last counted 4 calendar days ago isn't "3 consecutive sessions", it's 2
    // isolated days with a gap, even though lastCountedDate is simply "not today".
    const adjacentOrUnverifiable =
      previousSessionISO === null || storedStreak === 0 || lastCountedDate === previousSessionISO;
    const baseStreak = (lastCountedDate === today || adjacentOrUnverifiable) ? storedStreak : 0;
    if (!adjacentOrUnverifiable && lastCountedDate !== today) {
      log.push(`${sym}: streak gap — last counted ${lastCountedDate}, previous session was ${previousSessionISO} — not consecutive, restarting from 0`);
    }

    // effectiveStreak is this run's true reading — baseStreak only when genuinely carried
    // forward (already counted today, or a fetch failure), otherwise the fresh
    // increment/reset. The trade trigger below must use this, not baseStreak, or a
    // symbol that reaches 3 this run wouldn't be detected until the next one.
    let effectiveStreak = baseStreak;
    if (lastCountedDate === today) {
      log.push(`${sym}: already counted today — streak stays ${baseStreak}/3 (once-per-day counter)`);
    } else if (!ivEst) {
      // A fetch failure (rate limit, transient API error) isn't evidence the inversion
      // ended — carry the streak forward instead of resetting on noise.
      log.push(`${sym}: could not estimate IV — streak carried forward at ${baseStreak}/3, not counted as a reset`);
    } else if (hv > ivEst.iv) {
      effectiveStreak = baseStreak + 1;
      log.push(`${sym}: HV30 ${hv.toFixed(1)}% > IV ${ivEst.iv.toFixed(1)}% — inversion day ${effectiveStreak}/3`);
      stateUpdates.push({ key: streakKey, value: String(effectiveStreak) }, { key: dateKey, value: today });
    } else {
      effectiveStreak = 0;
      log.push(`${sym}: HV30 ${hv.toFixed(1)}% ≤ IV ${ivEst.iv.toFixed(1)}% — no inversion, streak reset (was ${baseStreak})`);
      stateUpdates.push({ key: streakKey, value: "0" }, { key: dateKey, value: today });
    }

    if (!tradeResult && effectiveStreak >= 3) {
      const straddle = await selectStraddleContracts(ctx.alpaca, sym, price);
      if (!straddle) {
        log.push(`${sym}: 3-session inversion ✓ but no contracts available to trade`);
      } else {
        const contractSym = spyAbove50 ? straddle.callSymbol : straddle.putSymbol;
        const straddleCost = ivEst ? ivEst.straddle * 100 : price * 0.03 * 100;
        const qty = sizeWithinBudget(ctx.perPositionBudget, straddleCost);
        if (qty === null) {
          // Budget skip, not a missing-contracts skip. effectiveStreak/stateUpdates above
          // are untouched either way, so the streak isn't lost — next run tries again.
          log.push(`${sym}: 3-session inversion ✓ but est. cost $${straddleCost.toFixed(0)} is too far over the $${ctx.perPositionBudget.toFixed(0)} budget — skip`);
        } else {
          const reason = `${sym}: HV > IV for 3 sessions — buying ${spyAbove50 ? "call" : "put"} (SPY ${spyAbove50 ? "↑" : "↓"} 50MA)`;
          log.push(`${sym}: ✓ SIGNAL — ${reason}`);
          tradeResult = {
            strategySlug: slug, underlying: sym, reason,
            orders: [{ asset: "option", symbol: contractSym, underlying: sym, side: "buy", qty, orderType: "market" }],
            stateUpdates: [],
            // Consume the signal only once the order is actually confirmed placed (runner.ts
            // applies this after the order succeeds, not before). `stateUpdates` above
            // already recorded today's natural increment (effectiveStreak, e.g. "3") — if the
            // order fails to place, that value is what persists, so the already-earned streak
            // isn't lost and doesn't have to be recounted from scratch.
            postOrderStateUpdates: [{ key: streakKey, value: "0" }],
          };
        }
      }
    }
  }

  if (tradeResult) return { fired: { ...tradeResult, stateUpdates }, log };
  if (stateUpdates.length) return { fired: { strategySlug: slug, underlying: "", reason: "streak counters updated", orders: [], stateUpdates }, log };
  return { fired: null, log };
}

// ── Macro: Sector Rotation ────────────────────────────────────────────────────

export async function signalSectorRotation(ctx: SignalContext): Promise<SignalResult> {
  const slug = "sector-rotation";
  const log: string[] = [];

  const lastMonth = stateStr(ctx.stateMap, sk(slug, "", "last_rot_month"));
  const thisMonth = new Date().toISOString().slice(0, 7);
  if (lastMonth === thisMonth) {
    return { fired: null, log: [`Already rotated this month (${thisMonth}) — monthly cooldown active`] };
  }

  const allBars = await Promise.allSettled(SECTOR_ETFS.map(t => bars(ctx.alpaca, t)));
  const ranked: { ticker: string; ret: number; price: number }[] = [];

  for (let i = 0; i < SECTOR_ETFS.length; i++) {
    const b = allBars[i];
    const sym = SECTOR_ETFS[i];
    if (b.status !== "fulfilled" || b.value.length < 55) {
      log.push(`${sym}: only ${b.status === "fulfilled" ? b.value.length : 0} bars — need 55+ for 1-month return + 50MA`);
      continue;
    }
    const closes = b.value.map(b => b.c);
    const ret = monthReturn(b.value);
    const ma50 = sma(closes, 50);
    const price = lastClose(b.value);
    if (price <= ma50) {
      log.push(`${sym}: 1m return ${(ret * 100).toFixed(1)}% — below 50MA ($${price.toFixed(2)} ≤ $${ma50.toFixed(2)}), trend filter fail`);
    } else {
      log.push(`${sym}: 1m return ${(ret * 100).toFixed(1)}%, above 50MA ✓`);
      ranked.push({ ticker: sym, ret, price });
    }
  }

  if (!ranked.length) {
    log.push("All sector ETFs below 50MA — no rotation signal");
    return { fired: null, log };
  }

  ranked.sort((a, b) => b.ret - a.ret);
  const top = ranked[0];
  log.push(`Top ETF: ${top.ticker} (+${(top.ret * 100).toFixed(1)}% 1m)`);

  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions, ctx.pendingOrderUnderlyings);
  if (busy.has(top.ticker)) {
    log.push(`Already holding ${top.ticker} — no rotation needed`);
    return { fired: null, log };
  }

  const orders: OrderSpec[] = [];
  for (const held of busy) {
    const pos = ctx.positions.find(p => p.symbol === held);
    if (pos) {
      log.push(`Selling current holding: ${held}`);
      orders.push({ asset: "stock", symbol: held, underlying: held, side: "sell", qty: Math.abs(parseFloat(pos.qty)), orderType: "market" });
    }
  }
  const qty = Math.max(1, Math.floor(ctx.perPositionBudget / top.price));
  const reason = `Rotate → ${top.ticker} (+${(top.ret * 100).toFixed(1)}% 1m, above 50MA)`;
  log.push(`✓ SIGNAL — ${reason}`);

  return {
    fired: {
      strategySlug: slug, underlying: top.ticker, reason,
      orders: [...orders, { asset: "stock", symbol: top.ticker, underlying: top.ticker, side: "buy", qty, orderType: "market" }],
      stateUpdates: [{ key: sk(slug, "", "last_rot_month"), value: thisMonth }],
    },
    log,
  };
}

// ── Macro: Quality Hold ───────────────────────────────────────────────────────

export async function signalQualityHold(ctx: SignalContext): Promise<SignalResult> {
  const slug = "quality-hold";
  const log: string[] = [];
  const universe = ctx.macroEquityList ?? MACRO_EQUITY_UNIVERSE_UNIQUE;
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions, ctx.pendingOrderUnderlyings);
  const scan = universe.filter(t => !busy.has(t));

  if (!scan.length) {
    return { fired: null, log: [`All ${universe.length} candidates already held — at max positions`] };
  }
  log.push(`Scanning ${scan.length} candidates (${ctx.macroEquityList ? "scanner" : "fallback"} list)`);

  const allBars = await Promise.allSettled(scan.map(t => bars(ctx.alpaca, t)));

  for (let i = 0; i < scan.length; i++) {
    const sym = scan[i];
    const b = allBars[i];
    if (b.status !== "fulfilled" || b.value.length < 60) {
      log.push(`${sym}: only ${b.status === "fulfilled" ? b.value.length : 0} bars — need 60+`);
      continue;
    }
    const h52 = high52w(b.value);
    const price = lastClose(b.value);
    if (!h52 || !price) { log.push(`${sym}: could not compute 52w high or price`); continue; }

    const drawdown = (h52 - price) / h52;
    if (drawdown < 0.10) {
      log.push(`${sym}: only ${(drawdown * 100).toFixed(1)}% below 52w high $${h52.toFixed(2)} — need 10–20% dip to buy`);
    } else if (drawdown > 0.20) {
      log.push(`${sym}: ${(drawdown * 100).toFixed(1)}% below 52w high $${h52.toFixed(2)} — too deep (>20%), possible fundamental issue`);
    } else {
      const qty = Math.max(1, Math.floor(ctx.perPositionBudget / price));
      const reason = `${sym}: ${(drawdown * 100).toFixed(1)}% below 52w high $${h52.toFixed(2)} — quality dip, buying ${qty} shares`;
      log.push(`✓ SIGNAL — ${reason}`);
      return {
        fired: {
          strategySlug: slug, underlying: sym, reason,
          orders: [{ asset: "stock", symbol: sym, underlying: sym, side: "buy", qty, orderType: "market" }],
          stateUpdates: [],
        },
        log,
      };
    }
  }

  return { fired: null, log };
}

// ── Macro: Economic Cycle ─────────────────────────────────────────────────────

export async function signalEconomicCycle(ctx: SignalContext): Promise<SignalResult> {
  const slug = "economic-cycle";
  const log: string[] = [];
  const dayName = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date().getDay()];

  if (new Date().getDay() !== 1) {
    return { fired: null, log: [`Only runs on Mondays — today is ${dayName}`] };
  }

  const allBars = await Promise.allSettled(CYCLE_TICKERS.map(t => bars(ctx.alpaca, t)));
  const bm: Record<string, Bar[]> = {};
  for (let i = 0; i < CYCLE_TICKERS.length; i++) {
    const r = allBars[i];
    if (r.status === "fulfilled") bm[CYCLE_TICKERS[i]] = r.value;
  }

  const spyB   = bm["SPY"] ?? [];
  const spyLast = lastClose(spyB);
  const spyMa50 = sma(spyB.map(b => b.c), 50);
  const xlkRet  = quarterReturn(bm["XLK"] ?? []);
  const xlpRet  = quarterReturn(bm["XLP"] ?? []);
  const spyQRet = quarterReturn(spyB);

  if (isNaN(spyMa50) || isNaN(xlkRet) || isNaN(xlpRet)) {
    return { fired: null, log: ["Could not compute cycle phase — insufficient bar data for SPY/XLK/XLP"] };
  }

  const spyAbove = spyLast > spyMa50;
  const growthLeads = xlkRet > xlpRet;
  let phase: "expansion" | "late" | "contraction" | "recovery";
  if      ( spyAbove &&  growthLeads) phase = "expansion";
  else if ( spyAbove && !growthLeads) phase = "late";
  else if (!spyAbove && (spyQRet ?? 0) < 0) phase = "contraction";
  else                                phase = "recovery";

  log.push(`SPY ${spyAbove ? "above" : "below"} 50MA, XLK ${(xlkRet*100).toFixed(1)}% vs XLP ${(xlpRet*100).toFixed(1)}% → phase: ${phase}`);

  const phaseETFs: Record<string, string[]> = {
    expansion: ["XLK", "XLY"], late: ["XLP", "XLV"],
    contraction: ["XLP", "XLU"], recovery: ["XLK", "XLF"],
  };
  const targets = phaseETFs[phase];
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions, ctx.pendingOrderUnderlyings);

  if (targets.every(t => busy.has(t)) && busy.size === targets.length) {
    log.push(`Already holding correct cycle ETFs for ${phase}: ${targets.join(" + ")} — no change`);
    return { fired: null, log };
  }

  const orders: OrderSpec[] = [];
  for (const held of busy) {
    if (!targets.includes(held)) {
      const pos = ctx.positions.find(p => p.symbol === held);
      if (pos) {
        log.push(`Selling ${held} (not in ${phase} phase)`);
        orders.push({ asset: "stock", symbol: held, underlying: held, side: "sell", qty: Math.abs(parseFloat(pos.qty)), orderType: "market" });
      }
    }
  }
  for (const target of targets) {
    if (!busy.has(target)) {
      const tb = bm[target] ?? await bars(ctx.alpaca, target);
      const price = lastClose(tb);
      if (!price) { log.push(`${target}: could not fetch price`); continue; }
      const qty = Math.max(1, Math.floor(ctx.perPositionBudget / price));
      log.push(`Buying ${target} for ${phase} phase`);
      orders.push({ asset: "stock", symbol: target, underlying: target, side: "buy", qty, orderType: "market" });
    }
  }

  if (!orders.length) return { fired: null, log };

  const reason = `Cycle: ${phase} — SPY ${spyAbove ? "↑" : "↓"} 50MA, XLK ${growthLeads ? ">" : "<"} XLP. Target: ${targets.join(" + ")}`;
  log.push(`✓ SIGNAL — ${reason}`);

  return {
    fired: {
      strategySlug: slug, underlying: targets[0], reason, orders,
      stateUpdates: [],
    },
    log,
  };
}

// ── Macro: Swing Trade ────────────────────────────────────────────────────────

export async function signalSwingTrade(ctx: SignalContext): Promise<SignalResult> {
  const slug = "swing-trade";
  const log: string[] = [];
  const universe = ctx.macroEquityList ?? MACRO_EQUITY_UNIVERSE_UNIQUE;
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions, ctx.pendingOrderUnderlyings);
  const scan = universe.filter(t => !busy.has(t));

  if (!scan.length) {
    return { fired: null, log: [`All ${universe.length} candidates already held — at max positions`] };
  }
  log.push(`Scanning ${scan.length} candidates (${ctx.macroEquityList ? "scanner" : "fallback"} list)`);

  const allBars = await Promise.allSettled(scan.map(t => bars(ctx.alpaca, t)));

  for (let i = 0; i < scan.length; i++) {
    const sym = scan[i];
    const b = allBars[i];
    if (b.status !== "fulfilled" || b.value.length < 60) {
      log.push(`${sym}: only ${b.status === "fulfilled" ? b.value.length : 0} bars — need 60+`);
      continue;
    }
    const closes = b.value.map(bar => bar.c);
    const price  = lastClose(b.value);
    const ma50   = sma(closes, 50);
    const rsiVal = rsi(closes, 14);

    if (!price || isNaN(ma50) || isNaN(rsiVal)) {
      log.push(`${sym}: could not compute price/MA50/RSI`);
      continue;
    }
    if (price <= ma50) {
      log.push(`${sym}: $${price.toFixed(2)} ≤ 50MA $${ma50.toFixed(2)} — not in uptrend`);
      continue;
    }
    if (rsiVal < 40 || rsiVal > 55) {
      log.push(`${sym}: above 50MA ✓ but RSI ${rsiVal.toFixed(0)} outside 40–55 pullback zone`);
      continue;
    }

    const qty = Math.max(1, Math.floor(ctx.perPositionBudget / price));
    const reason = `${sym}: above 50MA ($${ma50.toFixed(2)}), RSI ${rsiVal.toFixed(0)} in pullback zone — swing entry, ${qty} shares`;
    log.push(`✓ SIGNAL — ${reason}`);

    return {
      fired: {
        strategySlug: slug, underlying: sym, reason,
        orders: [{
          asset: "stock", symbol: sym, underlying: sym,
          side: "buy", qty, orderType: "bracket",
          takeProfitPrice: parseFloat((price * 1.10).toFixed(2)),
          stopLossPrice:   parseFloat((price * 0.95).toFixed(2)),
        }],
        stateUpdates: [],
      },
      log,
    };
  }

  return { fired: null, log };
}

// ── Exit checks ───────────────────────────────────────────────────────────────

// A strategy's options position(s) in one underlying, grouped so a straddle's two legs
// (same strategy, same underlying) are evaluated as ONE trade instead of two independently-
// stopped legs. Splitting them was a real bug: after a ~2% stock move the winning leg can
// cross +25% while the losing leg crosses -30% separately, so the "long vol" straddle gets
// closed as two directional trades instead of one volatility trade, and if only one leg's
// threshold trips, the strategy is left holding a naked single-leg position it never chose.
type ExitGroup = { slug: string; underlying: string; legs: Position[] };

function groupOptionPositions(
  positions: Position[],
  tags: SignalContext["tags"],
  slugs: Set<string>,
): ExitGroup[] {
  const groups = new Map<string, ExitGroup>();
  for (const pos of positions) {
    if (pos.asset_class !== "us_option") continue;
    const underlying = positionUnderlying(pos.symbol);

    // Exact-symbol match first: unambiguous even when two strategies have both, at
    // different times, traded the same underlying — the old underlying-only lookup
    // below picked an arbitrary row in that case (array order from the DB is
    // unspecified), which could merge unrelated trades into one exit-decision group
    // or, worse, route a position's exit through the wrong strategy's rules entirely.
    // Only rows written before exactSymbol existed (null) fall back to that old,
    // genuinely ambiguous lookup — matches today's behavior for positions opened
    // before this fix shipped, since their exact symbol was never recorded.
    const exactTag = tags.find(t => t.exactSymbol === pos.symbol);
    const tag = exactTag ?? tags.find(t => !t.exactSymbol && t.symbol.toUpperCase() === underlying.toUpperCase());
    if (!tag || !slugs.has(tag.strategySlug)) continue;

    const key = `${tag.strategySlug}:${underlying}`;
    if (!groups.has(key)) groups.set(key, { slug: tag.strategySlug, underlying, legs: [] });
    groups.get(key)!.legs.push(pos);
  }
  return [...groups.values()];
}

// Combined P&L% across every leg in the group, relative to their combined cost basis —
// for a single-leg directional trade this is just that leg's own plpc; for a straddle it's
// the straddle's P&L as one position, which is what the +25%/-30% rule is actually meant to
// measure (the straddle's value, not one leg of it in isolation).
//
// Alpaca's unrealized_pl is already a real dollar figure (contract multiplier included), but
// avg_entry_price is per-share premium — an option contract's cost basis needs ×100 to match.
function combinedPlpc(legs: Position[]): number {
  const costBasis = legs.reduce((s, p) => {
    const multiplier = p.asset_class === "us_option" ? 100 : 1;
    return s + Math.abs(parseFloat(p.avg_entry_price) * parseFloat(p.qty)) * multiplier;
  }, 0);
  const pl = legs.reduce((s, p) => s + parseFloat(p.unrealized_pl), 0);
  return costBasis > 0 ? pl / costBasis : 0;
}

// For a SHORT-premium position (cash-secured put, or a sell+buy credit spread), the %-based
// exit thresholds are meant relative to the CREDIT RECEIVED at entry — combinedPlpc's
// sum-of-magnitudes basis is correct for a straddle's buy+buy legs (total capital at risk
// really is both premiums paid) but wrong here: a credit spread's max achievable profit IS
// the net credit (short premium − long premium), not the sum of both legs' gross premiums.
// Using the gross sum as the denominator made the +50% profit target mathematically
// unreachable whenever the wing costs more than ~1/3 of the short leg's premium (a common
// case), and made the -100% stop require losing close to the position's full max loss
// instead of ~doubling the credit received. Degenerates correctly for a single short leg
// (a cash-secured put) — same result as combinedPlpc there.
function shortPremiumBasis(legs: Position[]): number {
  const netCredit = legs.reduce((s, p) => {
    const multiplier = p.asset_class === "us_option" ? 100 : 1;
    const premium = Math.abs(parseFloat(p.avg_entry_price) * parseFloat(p.qty)) * multiplier;
    return s + (p.side === "short" ? premium : -premium);
  }, 0);
  return Math.abs(netCredit);
}

function shortPremiumPlpc(legs: Position[]): number {
  const basis = shortPremiumBasis(legs);
  const pl = legs.reduce((s, p) => s + parseFloat(p.unrealized_pl), 0);
  return basis > 0 ? pl / basis : 0;
}

function minDte(legs: Position[]): number {
  return Math.min(...legs.map(p => {
    const parsed = parseOptionSymbol(p.symbol);
    return parsed ? Math.max(0, Math.round((new Date(parsed.expiry).getTime() - Date.now()) / 86400_000)) : 999;
  }));
}

export function checkMicroExits(
  positions: Position[],
  tags: SignalContext["tags"],
): ExitFired[] {
  // vrp-premium-short is handled by checkVrpPremiumShortExits instead — a SHORT premium
  // position needs different profit-target/stop-loss thresholds (50%/−100%, not the
  // long-side 25%/−30%) and a much tighter time stop (14 DTE, not 21) specifically to
  // avoid assignment risk recreating the stock-leg problem this strategy exists to avoid.
  const longVol = new Set(["vol-spread-long", "vrp-premium-seller", "vrp-inversion-long"]);
  const exits: ExitFired[] = [];

  for (const { slug, underlying, legs } of groupOptionPositions(positions, tags, longVol)) {
    const plpc = combinedPlpc(legs);
    const dte = minDte(legs);
    const legNote = legs.length > 1 ? ` (${legs.length}-leg trade, combined)` : "";

    let why: string | null = null;
    if (plpc >=  0.25) why = `+${(plpc * 100).toFixed(0)}%${legNote} — profit target hit`;
    if (plpc <= -0.30) why = `${(plpc * 100).toFixed(0)}%${legNote} — stop loss hit`;
    if (dte   <  21)   why = why ?? `${dte} DTE${legNote} — entering theta decay zone`;

    if (why) {
      for (const leg of legs) exits.push({ positionSymbol: leg.symbol, underlying, strategySlug: slug, reason: why });
    }
  }
  return exits;
}

// VRP Premium Short's own exit — different thresholds than the long-side rule in
// checkMicroExits because the risk profile is inverted:
//   - Profit target at 50% of credit captured (plpc >= 0.50), not 25% — the standard
//     practitioner convention for short premium (not academically sourced like the rest
//     of this file's citations; flagged here honestly as convention, not literature).
//   - Stop loss at plpc <= -1.0 (the position has lost 100% of the credit received, i.e.
//     roughly doubled against us) — looser in % terms than the long side's -30%, but far
//     more consequential in dollar terms since a short's loss is open-ended until capped
//     by a spread's wing; the wing already bounds the credit-spread side's worst case, so
//     this stop is really aimed at the cash-secured put side, which has no structural cap.
//   - Time stop at 14 DTE, not 21 — tighter specifically because a short option still open
//     into expiration risks ASSIGNMENT, which for the put side means being forced to buy
//     100 shares at the strike — exactly the stock-leg problem this strategy exists to
//     avoid recreating. 14 DTE leaves real buffer before gamma/assignment risk spikes.
//
// NOTE on unrealized_pl sign convention: this assumes Alpaca's unrealized_pl is already
// correctly signed (positive = profit) for a short option position the same way it is for
// a long one — which is the field's documented purpose, but this account has had zero open
// short option positions to confirm against a live fill. Worth a quick empirical check
// against the first real position this strategy opens.
export function checkVrpPremiumShortExits(
  positions: Position[],
  tags: SignalContext["tags"],
): ExitFired[] {
  const slug = "vrp-premium-short";
  const exits: ExitFired[] = [];

  for (const { underlying, legs } of groupOptionPositions(positions, tags, new Set([slug]))) {
    const plpc = shortPremiumPlpc(legs);
    const dte = minDte(legs);
    const legNote = legs.length > 1 ? ` (${legs.length}-leg spread, combined)` : "";

    let why: string | null = null;
    if (plpc >=  0.50) why = `+${(plpc * 100).toFixed(0)}%${legNote} — 50% of credit captured, profit target hit`;
    if (plpc <= -1.00) why = `${(plpc * 100).toFixed(0)}%${legNote} — stop loss hit (credit lost ~doubled against us)`;
    if (dte   <  14)   why = why ?? `${dte} DTE${legNote} — closing before assignment risk, not holding into expiry`;

    if (why) {
      for (const leg of legs) exits.push({ positionSymbol: leg.symbol, underlying, strategySlug: slug, reason: why });
    }
  }
  return exits;
}

// ── Exit checks: legacy equity ─────────────────────────────────────────────────
// Before the vrp-premium-seller/earnings-iv-crush fix, those two strategies ran
// covered calls (buy 100 shares + sell a call) instead of their documented long-options
// logic. Every current micro signal function trades options only now, so any open
// us_equity position in a micro account is a leftover stock leg from that old code —
// not something any live strategy would open, and strategy_trades tagging is unreliable
// for these anyway (the same underlying can be tagged by multiple strategies over time,
// e.g. an options underlying and a since-closed covered-call stock leg sharing one
// ticker). Rather than force-liquidate positions that are currently profitable, unwind
// them with a stop/target sized to each stock's own volatility — a flat percentage
// band makes no sense across names as different as MSTR (~94% annualised HV30) and
// JNJ (~18%): the same number is far too tight for one and far too loose for the other.
//
// Stop/target are expressed as a multiple of the stock's expected move over a 10-trading-
// day (~2 week) horizon, derived from HV30: dailyVol = hv/√252, expectedMove = dailyVol·√10.
// Stop = 1.5× that move, target = 3× — a 2:1 reward/risk ratio, scaled per stock.
// Clamped so a very quiet stock doesn't get a hair-trigger stop and a very volatile one
// doesn't get a stop so wide it stops mattering.
const LEGACY_HOLDING_DAYS = 10;
const LEGACY_STOP_SIGMA   = 1.5;
const LEGACY_TARGET_SIGMA = 3.0;
const LEGACY_STOP_FLOOR    = -0.08; // never tighter than -8%, even for a very quiet stock
const LEGACY_STOP_CEILING  = -0.35; // never looser than -35%, even for a very volatile one
const LEGACY_TARGET_FLOOR   = 0.15;
const LEGACY_TARGET_CEILING = 0.70;
// Flat fallback when HV30 can't be computed (not enough bars) — better than leaving
// the position completely unmanaged.
const LEGACY_FALLBACK_STOP   = -0.12;
const LEGACY_FALLBACK_TARGET =  0.20;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type LegacyBand = { stop: number; target: number; label: string };

function legacyBand(hv: number): LegacyBand {
  if (isNaN(hv)) {
    return { stop: LEGACY_FALLBACK_STOP, target: LEGACY_FALLBACK_TARGET, label: "fallback band, HV30 unavailable" };
  }
  const expectedMove = (hv / 100 / Math.sqrt(252)) * Math.sqrt(LEGACY_HOLDING_DAYS);
  return {
    stop:   clamp(-LEGACY_STOP_SIGMA   * expectedMove, LEGACY_STOP_CEILING,  LEGACY_STOP_FLOOR),
    target: clamp( LEGACY_TARGET_SIGMA * expectedMove, LEGACY_TARGET_FLOOR, LEGACY_TARGET_CEILING),
    label: `HV30 ${hv.toFixed(0)}%-scaled band`,
  };
}

async function legacyEquityBands(alpaca: AlpacaClient, equityPositions: Position[]) {
  const allBars = await Promise.allSettled(equityPositions.map(p => bars(alpaca, p.symbol)));
  return equityPositions.map((pos, i) => {
    const b = allBars[i];
    const hv = b.status === "fulfilled" ? hv30(b.value) : NaN;
    return { pos, ...legacyBand(hv) };
  });
}

export async function checkLegacyEquityExits(alpaca: AlpacaClient, positions: Position[]): Promise<ExitFired[]> {
  const equityPositions = positions.filter(p => p.asset_class === "us_equity");
  if (!equityPositions.length) return [];

  const banded = await legacyEquityBands(alpaca, equityPositions);
  const exits: ExitFired[] = [];

  for (const { pos, stop, target, label } of banded) {
    const plpc = parseFloat(pos.unrealized_plpc);
    let why: string | null = null;
    if (plpc >= target) why = `+${(plpc * 100).toFixed(1)}% ≥ +${(target * 100).toFixed(1)}% target (${label}) — legacy covered-call stock leg, profit target hit`;
    if (plpc <= stop)   why = `${(plpc * 100).toFixed(1)}% ≤ ${(stop * 100).toFixed(1)}% stop (${label}) — legacy covered-call stock leg, stop loss hit`;

    if (why) exits.push({ positionSymbol: pos.symbol, underlying: pos.symbol, strategySlug: "legacy-equity", reason: why });
  }
  return exits;
}

// ── Exit checks: capital-priority early exit ────────────────────────────────────
// perPositionBudget (runner.ts) is sized off total equity, not free cash. With equity
// this concentrated in legacy stock, new entries for strategies that DO have a real
// documented edge don't get rejected when cash is short — Alpaca's margin buying power
// funds them anyway, so the account quietly takes on leverage nobody asked for instead
// of the trade just being skipped. That's worse than a hard block.
//
// When this run's open strategy slots need more cash than is actually free, raise it
// from legacy stock before funding new entries, in priority order:
//   1. Winners closest to their own vol-target first — they've already captured the
//      most of their expected move, so selling here forfeits the least future return
//      per dollar freed (checkLegacyEquityExits would likely close these soon anyway).
//   2. Only once every winner is freed and there's still a shortfall, the smallest
//      losers first — minimizes the loss locked in to raise the rest.
// Never sells more than needed to cover the shortfall, and skips anything this run's
// hard stop/target check (checkLegacyEquityExits) already decided to close.
export async function selectLegacyEquityExitsForCapital(
  alpaca: AlpacaClient,
  candidates: Position[],
  capitalNeeded: number,
): Promise<ExitFired[]> {
  const equityPositions = candidates.filter(p => p.asset_class === "us_equity");
  if (capitalNeeded <= 0 || !equityPositions.length) return [];

  const banded = await legacyEquityBands(alpaca, equityPositions);
  const ranked = banded.map(({ pos, target }) => {
    const plpc = parseFloat(pos.unrealized_plpc);
    return { pos, plpc, progress: plpc / target, marketValue: Math.abs(parseFloat(pos.market_value)) };
  });

  const winners = ranked.filter(r => r.plpc > 0).sort((a, b) => b.progress - a.progress); // most of target captured first
  const losers  = ranked.filter(r => r.plpc <= 0).sort((a, b) => b.plpc - a.plpc);         // smallest loss first

  const exits: ExitFired[] = [];
  let freed = 0;
  for (const r of [...winners, ...losers]) {
    if (freed >= capitalNeeded) break;
    freed += r.marketValue;
    const why = r.plpc >= 0
      ? `freeing $${r.marketValue.toFixed(0)} for new entries — winner, ${(r.progress * 100).toFixed(0)}% of vol-target already captured`
      : `freeing $${r.marketValue.toFixed(0)} for new entries — smallest available loss (${(r.plpc * 100).toFixed(1)}%) among legacy positions`;
    exits.push({ positionSymbol: r.pos.symbol, underlying: r.pos.symbol, strategySlug: "legacy-equity", reason: why });
  }
  return exits;
}

// Same priority (winners closest to target, then smallest losers) but picks a fixed
// count rather than a dollar amount — for freeing exactly enough maxPositions slots,
// not raising a specific amount of cash. See selectLegacyEquityExitsForCapital's
// comment for why this exists: a strategy stuck at maxPositions because legacy stock
// occupies its counted slots never gets to run its signal function at all, independent
// of whether there's enough free cash.
export async function selectLegacyEquitySlotExits(
  alpaca: AlpacaClient,
  candidates: Position[],
  count: number,
): Promise<ExitFired[]> {
  const equityPositions = candidates.filter(p => p.asset_class === "us_equity");
  if (count <= 0 || !equityPositions.length) return [];

  const banded = await legacyEquityBands(alpaca, equityPositions);
  const ranked = banded.map(({ pos, target }) => {
    const plpc = parseFloat(pos.unrealized_plpc);
    return { pos, plpc, progress: plpc / target };
  });

  const winners = ranked.filter(r => r.plpc > 0).sort((a, b) => b.progress - a.progress);
  const losers  = ranked.filter(r => r.plpc <= 0).sort((a, b) => b.plpc - a.plpc);

  return [...winners, ...losers].slice(0, count).map(r => ({
    positionSymbol: r.pos.symbol, underlying: r.pos.symbol, strategySlug: "legacy-equity",
    reason: r.plpc >= 0
      ? `freeing a slot blocked by legacy stock — winner, ${(r.progress * 100).toFixed(0)}% of vol-target already captured`
      : `freeing a slot blocked by legacy stock — smallest available loss (${(r.plpc * 100).toFixed(1)}%)`,
  }));
}
