import { db } from "@/src/db/client";
import { engineState, engineRuns, strategyTrades, pushSubscriptions } from "@/src/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getAllTraders, getTraderById } from "../traders";
import { alpacaForTrader } from "../alpaca";
import type { Position, Order } from "../alpaca";
import { strategiesForType } from "../strategies";
import { webpush } from "../webpush";
import type { PushSubscriptionJSON } from "../webpush";
import {
  signalVolSpreadLong,
  signalRsiReversal,
  signalVrpPremiumShort,
  signalVrpInversionLong,
  signalSectorRotation,
  signalQualityHold,
  signalEconomicCycle,
  signalSwingTrade,
  checkMicroExits,
  checkVrpPremiumShortExits,
  checkLegacyEquityExits,
  selectLegacyEquityExitsForCapital,
  selectLegacyEquitySlotExits,
  positionUnderlying,
  type SignalResult,
  type ExitFired,
  type OrderSpec,
  type SignalContext,
} from "./signals";
import { loadScanList } from "./scanner";
import { isNYSEOpen } from "../marketHours";

// Positions currently open for a given strategy's tagged underlyings.
export function activePositionsFor(
  positions: Position[],
  tags: { strategySlug: string; symbol: string; exactSymbol?: string | null }[],
  slug: string,
) {
  // Exact-symbol match first (unambiguous — same lookup groupOptionPositions/
  // pendingOrdersFor use), falling back to the old underlying-only match only for legacy
  // (exactSymbol-less) tag rows. Without this, a position's maxPositions count could be
  // attributed to whichever strategy happens to have ANY historical tag for the same
  // underlying — not necessarily the one that actually opened this specific position —
  // double-counting one real position against two different strategies' caps.
  return positions.filter(p => {
    const underlying = positionUnderlying(p.symbol).toUpperCase();
    const exactTag = tags.find(t => t.exactSymbol === p.symbol);
    const tag = exactTag ?? tags.find(t => !t.exactSymbol && t.symbol.toUpperCase() === underlying);
    return tag?.strategySlug === slug;
  });
}

// A multi-leg (mleg) order's own top-level `symbol` is blank — Alpaca only populates the
// real option symbols per leg under `legs` (confirmed via Alpaca forum reports of this
// exact behavior). Falls back to the top-level symbol for an ordinary single-leg order.
function orderLegSymbols(o: Order): string[] {
  return o.legs?.length ? o.legs.map(l => l.symbol) : [o.symbol];
}

// Resting (unfilled) orders attributed to a strategy via the same exact-symbol tag lookup
// signals.ts's groupOptionPositions uses for positions — an order's own symbol is already
// the exact contract/stock symbol, so it matches a tag row's exactSymbol directly, falling
// back to the underlying-level guess only for pre-migration tag rows. Without this, a
// signal that fires every 5 minutes can keep placing MORE orders than its own maxPositions
// cap on names whose previous order just hasn't filled yet (position doesn't exist, so the
// old position-only count never saw it) — resting limit orders pile up instead of being
// capped, and all eventually land at once. Checks EVERY leg (not just a single top-level
// symbol) so a resting credit-spread combo is correctly counted as pending too.
export function pendingOrdersFor(
  openOrders: Order[],
  tags: { strategySlug: string; symbol: string; exactSymbol?: string | null }[],
  slug: string,
): Order[] {
  return openOrders.filter(o => orderLegSymbols(o).some(sym => {
    const underlying = positionUnderlying(sym).toUpperCase();
    const exactTag = tags.find(t => t.exactSymbol === sym);
    const tag = exactTag ?? tags.find(t => !t.exactSymbol && t.symbol.toUpperCase() === underlying);
    return tag?.strategySlug === slug;
  }));
}

export function pendingOrderUnderlyingsFor(
  openOrders: Order[],
  tags: { strategySlug: string; symbol: string; exactSymbol?: string | null }[],
  slug: string,
): Set<string> {
  const result = new Set<string>();
  for (const o of pendingOrdersFor(openOrders, tags, slug)) {
    for (const sym of orderLegSymbols(o)) result.add(positionUnderlying(sym).toUpperCase());
  }
  return result;
}

// Deterministic client_order_id: idempotency key for order placement. If the cron run
// retries (a timed-out HTTP call whose order actually went through, an overlapping
// workflow run, a crash between placeOrder and the strategy_trades insert) this makes the
// SAME intended trade collide at Alpaca's API instead of silently doubling the position —
// Alpaca rejects a duplicate client_order_id rather than placing a second order.
// Scoped to the calendar day: a strategy legitimately re-entering the same exact contract
// on a later day (closed, then reopened) must get a fresh id, not be blocked forever.
//
// KNOWN ACCEPTED RISK (reviewed, not blocking): this only catches a byte-identical retry —
// same contract/strike. If a retry lands minutes later after price has moved enough that
// the signal function picks a different ATM strike, the key differs, Alpaca does NOT reject
// it, and the original lost attempt's order (different symbol) is never recovered/tagged by
// anything — a second, genuinely new, correctly-tagged position can end up open on the same
// underlying alongside an untracked orphan from the first attempt. Recoverable by a human
// noticing unexpected exposure on a name; not a silent-capital-loss path.
export function orderIdempotencyKey(traderId: string, strategySlug: string, spec: OrderSpec): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const raw = `eng-${traderId}-${strategySlug}-${spec.symbol}-${spec.side}-${day}`;
  // Alpaca's client_order_id has a 128-char limit; this is always well under it in
  // practice, but truncate defensively rather than let an oversized id fail the request.
  return raw.slice(0, 128);
}

// Requires BOTH a mention of the client_order_id field AND a duplication-specific word
// ("unique"/"already"/"exists"/"duplicate") — a mention of the field name alone isn't
// enough, since a genuine validation error about the id (too long, bad characters) could
// also name the field without meaning "this id was already used". Misclassifying that as
// a harmless duplicate would skip a leg that never actually placed WITHOUT triggering the
// rollback path, silently leaving an earlier successful leg naked.
//
// Deliberately NOT gated on a specific HTTP status code (e.g. 422/409) — Alpaca's actual
// status for this specific violation isn't confirmed against a real response, only assumed,
// and getting that assumption wrong would be worse than not checking it at all: a real
// duplicate-id rejection that uses a different status would then be misclassified as a NEW
// failure, entering the rollback path and actively cancelling/closing a leg that was
// actually fine. The message-based check alone is already precise enough (requires both the
// field name and a duplication word) without that added risk.
export function isDuplicateClientOrderId(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  const mentionsClientOrderId = msg.includes("client_order_id") || msg.includes("client order id");
  const impliesDuplicate = msg.includes("unique") || msg.includes("already") || msg.includes("exists") || msg.includes("duplicate");
  return mentionsClientOrderId && impliesDuplicate;
}

// ── Signal function registry ──────────────────────────────────────────────────

const SIGNAL_FNS: Record<string, (ctx: SignalContext) => Promise<SignalResult>> = {
  "vol-spread-long":    signalVolSpreadLong,
  "vrp-premium-seller": signalRsiReversal,
  "vrp-premium-short":  signalVrpPremiumShort,
  "vrp-inversion-long": signalVrpInversionLong,
  "sector-rotation":    signalSectorRotation,
  "quality-hold":       signalQualityHold,
  "economic-cycle":     signalEconomicCycle,
  "swing-trade":        signalSwingTrade,
};

// ── Engine state helpers ──────────────────────────────────────────────────────

async function loadStateMap(traderId: string): Promise<Map<string, string>> {
  const rows = await db.select().from(engineState).where(eq(engineState.traderId, traderId));
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.key, r.value);  // key = full sk() string
  return map;
}

async function saveStateUpdates(
  traderId: string,
  strategySlug: string,
  updates: { key: string; value: string }[],
) {
  for (const { key, value } of updates) {
    const existing = await db
      .select({ id: engineState.id })
      .from(engineState)
      .where(and(eq(engineState.traderId, traderId), eq(engineState.key, key)))
      .limit(1);

    if (existing.length > 0) {
      await db.update(engineState)
        .set({ value, updatedAt: new Date() })
        .where(and(eq(engineState.traderId, traderId), eq(engineState.key, key)));
    } else {
      await db.insert(engineState).values({
        id: crypto.randomUUID(),
        traderId,
        strategySlug,
        key,
        value,
        updatedAt: new Date(),
      });
    }
  }
}

// ── Order execution ───────────────────────────────────────────────────────────

// Maximum acceptable bid-ask spread as a fraction of mid-price.
// 30% is generous for options but filters out obviously illiquid contracts.
const MAX_SPREAD_FRACTION = 0.30;
const MIN_BID_SIZE = 1; // at least 1 contract quoted on each side

async function executeOrder(
  alpaca: ReturnType<typeof alpacaForTrader>,
  spec: OrderSpec,
  clientOrderId: string,
) {
  if (spec.asset === "option") {
    // Fetch live quote to check liquidity and use limit order at mid-price
    let limitPrice: string | undefined;
    try {
      const snap = await alpaca.getOptionsSnapshots([spec.symbol]);
      const q = snap.snapshots?.[spec.symbol]?.latestQuote;
      if (q && q.bp > 0 && q.ap > 0 && q.bs >= MIN_BID_SIZE && q.as >= MIN_BID_SIZE) {
        const spread = q.ap - q.bp;
        const mid    = (q.ap + q.bp) / 2;
        if (spread / mid > MAX_SPREAD_FRACTION) {
          throw new Error(
            `spread too wide: bid $${q.bp} / ask $${q.ap} = ${((spread / mid) * 100).toFixed(0)}% (max ${MAX_SPREAD_FRACTION * 100}%)`,
          );
        }
        // Use limit order at mid-price, rounded to nearest cent
        limitPrice = mid.toFixed(2);
      }
    } catch (e) {
      // If it's our own spread error, rethrow so the caller logs it
      if (e instanceof Error && e.message.startsWith("spread too wide")) throw e;
      console.warn(`[engine] snapshot fetch failed for ${spec.symbol}, falling back to market order:`, e);
    }

    return alpaca.placeOptionOrder({
      symbol:         spec.symbol,
      side:           spec.side,
      type:           limitPrice ? "limit" : "market",
      time_in_force:  "day",
      qty:            String(spec.qty),
      ...(limitPrice ? { limit_price: limitPrice } : {}),
      client_order_id: clientOrderId,
    });
  }

  // Multi-leg option order (e.g. a credit call spread). Fills/rejects atomically — Alpaca
  // requires every leg covered within the same order, so there's no partial-leg state to
  // reconcile here the way there is for the straddle's two independent `simple` orders.
  //
  // Unlike the single-leg option branch above, this NEVER falls back to an unprotected
  // market order on a 2-leg combo — a missing quote or a non-positive net credit both throw
  // instead. For a single option, market-vs-limit is a liquidity tradeoff; for a 2-leg
  // combo it's a bigger deal (a market fill could land at a materially different net price,
  // in principle even a net DEBIT, defeating the entire premise of a premium-selling
  // trade), and a non-positive net credit from REAL quotes on a correctly-constructed
  // credit spread (near-strike short should always be worth more than the further-OTM long
  // wing) is itself a red flag — a bad/stale quote or a mispriced wing — not a "fall back to
  // market" situation.
  if (spec.asset === "option_spread") {
    if (!spec.legs?.length) throw new Error(`option_spread order for ${spec.symbol} has no legs`);

    const snap = await alpaca.getOptionsSnapshots(spec.legs.map(l => l.symbol));
    const mids = spec.legs.map(l => {
      const q = snap.snapshots?.[l.symbol]?.latestQuote;
      if (!q || q.bp <= 0 || q.ap <= 0 || q.bs < MIN_BID_SIZE || q.as < MIN_BID_SIZE) return null;
      return { leg: l, mid: (q.ap + q.bp) / 2, spread: q.ap - q.bp };
    });
    if (mids.some(m => m === null)) {
      throw new Error(`could not get a live quote for every leg of ${spec.symbol} combo — refusing to place as an unprotected market order`);
    }
    const priced = mids as NonNullable<(typeof mids)[number]>[];

    if (priced.some(m => m.mid > 0 && m.spread / m.mid > MAX_SPREAD_FRACTION)) {
      throw new Error(`spread too wide on one or more legs of ${spec.symbol} combo`);
    }

    // Net credit = what we receive selling the short leg(s) minus what we pay for the
    // long leg(s) — the limit_price Alpaca wants for an mleg order is this ONE net number
    // for the whole combo, not a per-leg price.
    const netCredit = priced.reduce((sum, m) => sum + (m.leg.side === "sell" ? m.mid : -m.mid), 0);
    if (netCredit <= 0) {
      throw new Error(`${spec.symbol} combo priced at a non-positive net credit ($${netCredit.toFixed(2)}) from live quotes — refusing, this shouldn't happen for a correctly-built credit spread`);
    }

    return alpaca.placeMultiLegOrder({
      legs: spec.legs.map(l => ({
        symbol: l.symbol,
        ratio_qty: "1",
        side: l.side,
        position_intent: l.positionIntent,
      })),
      qty: String(spec.qty),
      type: "limit",
      limit_price: netCredit.toFixed(2),
      time_in_force: "day",
      client_order_id: clientOrderId,
    });
  }

  // Stock order
  if (spec.orderType === "bracket") {
    return alpaca.placeOrder({
      symbol: spec.symbol,
      side: spec.side,
      type: "market",
      client_order_id: clientOrderId,
      // The parent fills same-day regardless (it's a market order), but Alpaca's bracket
      // child legs (take_profit/stop_loss) inherit the parent's time_in_force. "day" meant
      // both legs were cancelled at the close, so from day 2 onward the position had no
      // stop, no target, and no engine-side exit either (swing-trade isn't covered by
      // checkMicroExits). "gtc" keeps the legs live until one of them fills.
      // NOTE: the strategy's documented 10-day time stop ("reassess if price hasn't moved")
      // still isn't implemented anywhere — gtc only fixes the brackets dying early, it
      // doesn't add the missing time-based exit. See the quant review's remaining-work list.
      time_in_force: "gtc",
      qty: String(spec.qty),
      order_class: "bracket",
      take_profit: { limit_price: String(spec.takeProfitPrice!) },
      stop_loss:   { stop_price: String(spec.stopLossPrice!) },
    });
  }

  return alpaca.placeOrder({
    symbol: spec.symbol,
    side: spec.side,
    type: "market",
    time_in_force: "day",
    qty: String(spec.qty),
    client_order_id: clientOrderId,
  });
}

// ── Push notification helper ──────────────────────────────────────────────────

async function pushToTrader(traderId: string, title: string, body: string) {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.traderId, traderId));

  const payload = JSON.stringify({ title, body, url: "/strategies" });

  for (const row of subs) {
    try {
      await webpush().sendNotification(row.subscription as PushSubscriptionJSON, payload);
    } catch {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
    }
  }
}

// ── Per-trader engine run ─────────────────────────────────────────────────────

export type RunResult = {
  traderId: string;
  phase: "entry" | "exit";
  signals: { strategy: string; underlying: string; reason: string; log: string[] }[];
  trades: { strategy: string; symbol: string; side: string; qty: number }[];
  exits: { symbol: string; reason: string }[];
  skipped: { strategy: string; reason: string; log: string[] }[];
  errors: { strategy: string; error: string }[];
};

export async function runEngineForTrader(
  traderId: string,
  phase: "entry" | "exit",
): Promise<RunResult> {
  const result: RunResult = {
    traderId, phase,
    signals: [], trades: [], exits: [], skipped: [], errors: [],
  };

  const [traderRaw, stateMap] = await Promise.all([
    getTraderById(traderId),
    loadStateMap(traderId),
  ]);
  if (!traderRaw) throw new Error(`Trader ${traderId} not found`);
  const trader = traderRaw;

  const alpaca = alpacaForTrader(trader);
  const [account, positions, openOrders, tags, microScanList, macroEquityList] = await Promise.all([
    alpaca.getAccount(),
    alpaca.getPositions(),
    alpaca.getOrders("open"),
    db.select({
        strategySlug: strategyTrades.strategySlug,
        symbol: strategyTrades.symbol,
        exactSymbol: strategyTrades.exactSymbol,
      })
      .from(strategyTrades)
      .where(eq(strategyTrades.traderId, traderId))
      // Most-recent-first so the legacy (exactSymbol-less) fallback lookup in
      // groupOptionPositions/activeUnderlyings picks the latest strategy to have
      // tagged an underlying, not an unspecified DB row order, when it has to guess.
      .orderBy(desc(strategyTrades.createdAt)),
    trader.type === "micro" ? loadScanList("micro") : Promise.resolve(null),
    trader.type === "macro" ? loadScanList("macro") : Promise.resolve(null),
  ]);

  const equity = parseFloat(account.equity);
  const optionsBuyingPower = parseFloat(account.options_buying_power);
  const strategies = strategiesForType(trader.type);

  // ── EXIT PHASE ──────────────────────────────────────────────────────────────
  if (phase === "exit") {
    if (trader.type === "micro") {
      const microExits = [
        ...checkMicroExits(positions, tags),
        ...checkVrpPremiumShortExits(positions, tags),
        ...await checkLegacyEquityExits(alpaca, positions),
      ];

      // perPositionBudget (below, entry phase) is sized off total equity, not free cash.
      // If this run's open strategy slots would need more than what's actually free, raise
      // it from legacy stock now rather than let the entry phase quietly fund new option
      // buys on margin. Only looks at slots with no signal function dead — a strategy whose
      // fn doesn't exist can't fire anyway, so it shouldn't reserve capital.
      const openSlotBudget = strategies.reduce((sum, s) => {
        if (!SIGNAL_FNS[s.slug]) return sum;
        const active = activePositionsFor(positions, tags, s.slug).length;
        return active < s.maxPositions ? sum + equity * (s.allocationPct / 100) / s.maxPositions : sum;
      }, 0);
      const freeCash = parseFloat(account.cash);
      const shortfall = openSlotBudget - freeCash;

      if (shortfall > 0) {
        const alreadyExiting = new Set(microExits.map(e => e.positionSymbol));
        const candidates = positions.filter(p => !alreadyExiting.has(p.symbol));
        const capitalExits = await selectLegacyEquityExitsForCapital(alpaca, candidates, shortfall);
        microExits.push(...capitalExits);
      }

      // Cash isn't the only way legacy stock blocks a strategy — maxPositions counts
      // ANY tagged position, so a strategy sitting at its cap because old stock occupies
      // those slots never runs its signal function at all, regardless of free cash. Free
      // exactly one slot per blocked strategy (not all of them) so it can resume on the
      // next entry run while the rest keep working toward their own vol-target.
      for (const s of strategies) {
        if (!SIGNAL_FNS[s.slug]) continue;
        const active = activePositionsFor(positions, tags, s.slug);
        if (active.length < s.maxPositions) continue;
        const alreadyExiting = new Set(microExits.map(e => e.positionSymbol));
        const legacyHeld = active.filter(p => p.asset_class === "us_equity" && !alreadyExiting.has(p.symbol));
        if (!legacyHeld.length) continue;
        microExits.push(...await selectLegacyEquitySlotExits(alpaca, legacyHeld, 1));
      }

      for (const ex of microExits) {
        try {
          await alpaca.closePosition(ex.positionSymbol);
          result.exits.push({ symbol: ex.positionSymbol, reason: ex.reason });
          await pushToTrader(
            traderId,
            `Closed ${ex.underlying}`,
            `${ex.strategySlug}: ${ex.reason}`,
          );
        } catch (e) {
          result.errors.push({ strategy: ex.strategySlug, error: String(e) });
        }
      }
    }
    // Macro exits: sector-rotation and economic-cycle are handled by next entry signal;
    // quality-hold exits are intentionally manual; swing-trade uses Alpaca bracket orders.
    await logRun(traderId, phase, result);
    return result;
  }

  // ── ENTRY PHASE ─────────────────────────────────────────────────────────────
  // Track underlyings traded THIS run so two strategies can't pick the same stock
  const tradedThisRun = new Set<string>();

  for (const strategy of strategies) {
    const fn = SIGNAL_FNS[strategy.slug];
    if (!fn) continue;

    // Count positions already active for this strategy, PLUS any resting order not yet
    // filled — otherwise a strategy whose last entry is still an unfilled limit order looks
    // like it has an open slot and can place another one every 5 minutes until they all land.
    const activePositions = activePositionsFor(positions, tags, strategy.slug);
    const pendingOrders = pendingOrdersFor(openOrders, tags, strategy.slug);

    if (activePositions.length + pendingOrders.length >= strategy.maxPositions) {
      result.skipped.push({
        strategy: strategy.slug,
        reason: `at max ${strategy.maxPositions} positions${pendingOrders.length ? ` (${pendingOrders.length} pending order(s) counted)` : ""}`,
        log: [],
      });
      continue;
    }

    const perPositionBudget = equity * (strategy.allocationPct / 100) / strategy.maxPositions;

    const ctx: SignalContext = {
      alpaca,
      equity,
      perPositionBudget,
      optionsBuyingPower,
      positions,
      tags,
      pendingOrderUnderlyings: pendingOrderUnderlyingsFor(openOrders, tags, strategy.slug),
      stateMap,
      microScanList,
      macroEquityList,
    };

    let signalResult: SignalResult;
    try {
      signalResult = await fn(ctx);
    } catch (e) {
      result.errors.push({ strategy: strategy.slug, error: String(e) });
      continue;
    }

    const { fired, log } = signalResult;

    if (!fired) {
      result.skipped.push({ strategy: strategy.slug, reason: "no signal", log });
      continue;
    }

    // Always save state updates (even if no orders)
    if (fired.stateUpdates.length) {
      try {
        await saveStateUpdates(traderId, fired.strategySlug || strategy.slug, fired.stateUpdates);
        for (const u of fired.stateUpdates) stateMap.set(u.key, u.value);
      } catch (e) {
        result.errors.push({ strategy: strategy.slug, error: `state save: ${String(e)}` });
      }
    }

    if (!fired.orders.length) continue;

    // Skip if another strategy already traded this underlying this run
    if (fired.underlying && tradedThisRun.has(fired.underlying.toUpperCase())) {
      result.skipped.push({
        strategy: strategy.slug,
        reason: `${fired.underlying} already traded by another strategy this run`,
        log,
      });
      continue;
    }
    if (fired.underlying) tradedThisRun.add(fired.underlying.toUpperCase());

    result.signals.push({
      strategy: strategy.slug,
      underlying: fired.underlying,
      reason: fired.reason,
      log,
    });

    // Place each order in the signal. For a multi-leg signal (a straddle's call + put) a
    // later leg failing after an earlier leg already went through would otherwise leave the
    // strategy holding a naked single-leg position it never chose — a straddle's risk
    // profile depends on both legs being open, not one directional bet. Roll back whatever
    // already placed rather than leave it standing.
    const placedLegs: { symbol: string; orderId: string }[] = [];
    let legFailed = false;

    // KNOWN ACCEPTED RISK (reviewed, not blocking): this does not verify afterward that a
    // leg actually ended up flat — cancelOrder/closePosition failures are swallowed on the
    // assumption that exactly one of the two is always an expected no-op depending on fill
    // state, and the log message below unconditionally claims success. A genuine transient
    // failure on BOTH calls (not the expected no-op) would leave the leg exactly as it was
    // with no retry and no distinguishing log — recoverable by a human noticing an
    // unexpected position, not a silent-capital-loss path.
    async function rollbackPlacedLegs(reasonSuffix: string) {
      for (const leg of placedLegs) {
        try { await alpaca.cancelOrder(leg.orderId); } catch { /* already filled or gone */ }
        try { await alpaca.closePosition(leg.symbol); } catch { /* never filled, nothing to close */ }
      }
      result.errors.push({
        strategy: strategy.slug,
        error: `rolled back ${placedLegs.length} already-placed leg(s) (${placedLegs.map(l => l.symbol).join(", ")}) ${reasonSuffix}`,
      });
    }

    for (const spec of fired.orders) {
      if (legFailed) {
        result.skipped.push({
          strategy: strategy.slug,
          reason: `order ${spec.symbol}: skipped — an earlier leg of this trade failed to place`,
          log: [],
        });
        continue;
      }

      // Deterministic per-strategy/symbol/side/day id — if this exact call is a retry (a
      // timed-out request whose order actually went through, an overlapping cron run), the
      // real placeOrder/placeOptionOrder call below rejects the duplicate instead of
      // silently doubling the position.
      const clientOrderId = orderIdempotencyKey(traderId, strategy.slug, spec);

      let orderId: string;
      let recoveredDuplicate = false;
      try {
        const order = await executeOrder(alpaca, spec, clientOrderId);
        orderId = order.id;
      } catch (e) {
        if (isDuplicateClientOrderId(e)) {
          // Alpaca already has an order with this id — from an earlier attempt whose
          // response never reached this process (timeout, overlapping cron run). Recover
          // the real order rather than just skipping: skipping without tagging would leave
          // a position that genuinely exists completely untracked, since
          // checkMicroExits/checkVrpPremiumShortExits only manage a position that has a
          // strategy_trades tag at all.
          try {
            const existing = await alpaca.getOrderByClientId(clientOrderId);
            orderId = existing.id;
            recoveredDuplicate = true;
            result.skipped.push({
              strategy: strategy.slug,
              reason: `order ${spec.symbol}: recovered already-placed order ${existing.id} (duplicate client_order_id) instead of re-placing`,
              log: [],
            });
          } catch (lookupErr) {
            result.errors.push({
              strategy: strategy.slug,
              error: `order ${spec.symbol}: duplicate client_order_id but could not recover the original order: ${String(lookupErr)}`,
            });
            legFailed = true;
            if (placedLegs.length > 0) await rollbackPlacedLegs(`after ${spec.symbol}'s duplicate order could not be recovered`);
            continue;
          }
        } else {
          result.errors.push({ strategy: strategy.slug, error: `order ${spec.symbol}: ${String(e)}` });

          // Set on ANY genuine failure, not just one after a prior success — otherwise a
          // straddle's FIRST leg failing (placedLegs still empty here) wouldn't stop the
          // second leg from being attempted, placing a naked position the signal never
          // intended on its own.
          legFailed = true;
          if (placedLegs.length > 0) await rollbackPlacedLegs(`after ${spec.symbol} failed to place`);
          continue;
        }
      }

      placedLegs.push({ symbol: spec.symbol, orderId });
      if (!recoveredDuplicate) {
        result.trades.push({
          strategy: strategy.slug,
          symbol: spec.symbol,
          side: spec.side,
          qty: spec.qty,
        });
      }

      // Record trade and send push — failures here don't roll back the order. For a
      // recovered duplicate, only insert a tag that doesn't already exist (an earlier
      // retry may have already recovered and tagged this same order), and skip the push —
      // the trader was already notified when this order first succeeded.
      //
      // A spread's combo fills as ONE order but has MULTIPLE real positions (the short leg
      // AND the long wing) — each needs its OWN exact-symbol tag row, or the wing leg would
      // have no tag at all and groupOptionPositions/checkVrpPremiumShortExits would never
      // see or manage it (exactly the orphaned-position failure mode Finding #3 fixed for
      // the duplicate-retry case — don't reintroduce it here for spreads).
      const legsToTag = spec.asset === "option_spread" && spec.legs?.length
        ? spec.legs.map(l => ({ symbol: l.symbol, side: l.side }))
        : [{ symbol: spec.symbol, side: spec.side }];

      for (const leg of legsToTag) {
        try {
          let alreadyTagged = false;
          if (recoveredDuplicate) {
            const existingRow = await db.select({ id: strategyTrades.id })
              .from(strategyTrades)
              .where(and(eq(strategyTrades.orderId, orderId), eq(strategyTrades.exactSymbol, leg.symbol)))
              .limit(1);
            alreadyTagged = existingRow.length > 0;
          }
          if (!alreadyTagged) {
            await db.insert(strategyTrades).values({
              id: crypto.randomUUID(),
              traderId,
              strategySlug: strategy.slug,
              orderId,
              symbol: spec.underlying,
              exactSymbol: leg.symbol,
              side: leg.side,
            });
          }
        } catch (e) {
          console.error(`[engine] strategyTrades insert failed for ${leg.symbol}:`, e);
        }
      }

      if (!recoveredDuplicate) {
        try {
          await pushToTrader(
            traderId,
            `Engine: ${strategy.name}`,
            `${spec.side.toUpperCase()} ${spec.qty}× ${spec.symbol} — ${fired.reason}`,
          );
        } catch (e) {
          console.error(`[engine] push notification failed for ${spec.symbol}:`, e);
        }
      }
    }

    // Only now that every leg is confirmed placed (no genuine failure — a duplicate
    // client_order_id skip still counts, since that means the trade already exists from an
    // earlier attempt) is it safe to "consume" the signal, e.g. resetting a streak counter.
    // Applying this unconditionally (like `stateUpdates` above) would have thrown away an
    // already-earned signal whenever the order itself failed to place.
    if (!legFailed && fired.postOrderStateUpdates?.length) {
      try {
        await saveStateUpdates(traderId, fired.strategySlug || strategy.slug, fired.postOrderStateUpdates);
        for (const u of fired.postOrderStateUpdates) stateMap.set(u.key, u.value);
      } catch (e) {
        result.errors.push({ strategy: strategy.slug, error: `post-order state save: ${String(e)}` });
      }
    }
  }

  await logRun(traderId, phase, result);
  return result;
}

// ── Log run to DB ─────────────────────────────────────────────────────────────

async function logRun(traderId: string, phase: "entry" | "exit", result: RunResult) {
  await db.insert(engineRuns).values({
    id: crypto.randomUUID(),
    traderId,
    phase,
    signals:  result.signals  as unknown as Record<string, unknown>[],
    trades:   result.trades   as unknown as Record<string, unknown>[],
    skipped:  result.skipped  as unknown as Record<string, unknown>[],
    errors:   result.errors   as unknown as Record<string, unknown>[],
  });
}

// ── Run engine for all traders ────────────────────────────────────────────────

export async function runEngine(
  phase: "entry" | "exit",
  traderType?: "micro" | "macro",
): Promise<RunResult[]> {
  // ET-based market hours check (fast, no API call needed)
  if (!isNYSEOpen()) {
    const etTime = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    console.log(`[engine] Market closed (ET: ${etTime}) — skipping ${phase}`);
    return [];
  }

  const all = await getAllTraders();
  const traders = traderType ? all.filter(t => t.type === traderType) : all;

  // Verify with Alpaca clock — handles market holidays that isNYSEOpen() can't know about
  if (traders.length > 0) {
    try {
      const clock = await alpacaForTrader(traders[0]).getClock();
      if (!clock.is_open) {
        console.log(`[engine] Market holiday/early-close (Alpaca clock) — skipping ${phase}`);
        return [];
      }
    } catch (e) {
      console.warn("[engine] Could not fetch Alpaca market clock:", e);
      // Continue — ET check already passed, don't block on Alpaca failure
    }
  }

  const results = await Promise.allSettled(
    traders.map(t => runEngineForTrader(t.id, phase)),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<RunResult> => r.status === "fulfilled")
    .map(r => r.value);
}
