import { db } from "@/src/db/client";
import { engineState, engineRuns, strategyTrades, pushSubscriptions } from "@/src/db/schema";
import { eq, and } from "drizzle-orm";
import { getAllTraders, getTraderById } from "../traders";
import { alpacaForTrader } from "../alpaca";
import { strategiesForType } from "../strategies";
import { webpush } from "../webpush";
import type { PushSubscriptionJSON } from "../webpush";
import {
  signalVolSpreadLong,
  signalVrpPremiumSeller,
  signalEarningsIVCrush,
  signalVrpInversionLong,
  signalSectorRotation,
  signalQualityHold,
  signalEconomicCycle,
  signalSwingTrade,
  checkMicroExits,
  type SignalResult,
  type ExitFired,
  type OrderSpec,
  type SignalContext,
} from "./signals";
import { loadScanList } from "./scanner";
import { isNYSEOpen } from "../marketHours";

// ── Signal function registry ──────────────────────────────────────────────────

const SIGNAL_FNS: Record<string, (ctx: SignalContext) => Promise<SignalResult>> = {
  "vol-spread-long":    signalVolSpreadLong,
  "vrp-premium-seller": signalVrpPremiumSeller,
  "earnings-iv-crush":  signalEarningsIVCrush,
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
    });
  }

  // Stock order
  if (spec.orderType === "bracket") {
    return alpaca.placeOrder({
      symbol: spec.symbol,
      side: spec.side,
      type: "market",
      time_in_force: "day",
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
  const [account, positions, tags, microScanList, macroEquityList] = await Promise.all([
    alpaca.getAccount(),
    alpaca.getPositions(),
    db.select({ strategySlug: strategyTrades.strategySlug, symbol: strategyTrades.symbol })
      .from(strategyTrades)
      .where(eq(strategyTrades.traderId, traderId)),
    trader.type === "micro" ? loadScanList("micro") : Promise.resolve(null),
    trader.type === "macro" ? loadScanList("macro") : Promise.resolve(null),
  ]);

  const equity = parseFloat(account.equity);
  const strategies = strategiesForType(trader.type);

  // ── EXIT PHASE ──────────────────────────────────────────────────────────────
  if (phase === "exit") {
    if (trader.type === "micro") {
      const microExits = checkMicroExits(positions, tags);
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

    // Count positions already active for this strategy
    const activeSlugs = tags.filter(t => t.strategySlug === strategy.slug);
    const activePositions = positions.filter(p => {
      const sym = p.symbol.toUpperCase();
      return activeSlugs.some(t => sym === t.symbol.toUpperCase() || sym.startsWith(t.symbol.toUpperCase()));
    });

    if (activePositions.length >= strategy.maxPositions) {
      result.skipped.push({ strategy: strategy.slug, reason: `at max ${strategy.maxPositions} positions`, log: [] });
      continue;
    }

    const perPositionBudget = equity * (strategy.allocationPct / 100) / strategy.maxPositions;

    const ctx: SignalContext = {
      alpaca,
      equity,
      perPositionBudget,
      positions,
      tags,
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

    // Place each order in the signal
    for (const spec of fired.orders) {
      let orderId: string | undefined;
      try {
        const order = await executeOrder(alpaca, spec);
        orderId = order.id;
        result.trades.push({
          strategy: strategy.slug,
          symbol: spec.symbol,
          side: spec.side,
          qty: spec.qty,
        });
      } catch (e) {
        result.errors.push({ strategy: strategy.slug, error: `order ${spec.symbol}: ${String(e)}` });
        continue;
      }

      // Record trade and send push — failures here don't roll back the order
      try {
        await db.insert(strategyTrades).values({
          id: crypto.randomUUID(),
          traderId,
          strategySlug: strategy.slug,
          orderId,
          symbol: spec.underlying,
          side: spec.side,
        });
      } catch (e) {
        console.error(`[engine] strategyTrades insert failed for ${spec.symbol}:`, e);
      }

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
