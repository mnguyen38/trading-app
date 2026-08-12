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
  type SignalFired,
  type ExitFired,
  type OrderSpec,
  type SignalContext,
} from "./signals";

// ── Signal function registry ──────────────────────────────────────────────────

const SIGNAL_FNS: Record<string, (ctx: SignalContext) => Promise<SignalFired | null>> = {
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

async function executeOrder(
  alpaca: ReturnType<typeof alpacaForTrader>,
  spec: OrderSpec,
) {
  if (spec.asset === "option") {
    return alpaca.placeOptionOrder({
      symbol: spec.symbol,
      side: spec.side,
      type: "market",
      time_in_force: "day",
      qty: String(spec.qty),
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
      await webpush.sendNotification(row.subscription as PushSubscriptionJSON, payload);
    } catch {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
    }
  }
}

// ── Per-trader engine run ─────────────────────────────────────────────────────

export type RunResult = {
  traderId: string;
  phase: "entry" | "exit";
  signals: { strategy: string; underlying: string; reason: string }[];
  trades: { strategy: string; symbol: string; side: string; qty: number }[];
  exits: { symbol: string; reason: string }[];
  skipped: { strategy: string; reason: string }[];
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
  const [account, positions, tags] = await Promise.all([
    alpaca.getAccount(),
    alpaca.getPositions(),
    db.select({ strategySlug: strategyTrades.strategySlug, symbol: strategyTrades.symbol })
      .from(strategyTrades)
      .where(eq(strategyTrades.traderId, traderId)),
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
      result.skipped.push({ strategy: strategy.slug, reason: `at max ${strategy.maxPositions} positions` });
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
    };

    let fired: SignalFired | null = null;
    try {
      fired = await fn(ctx);
    } catch (e) {
      result.errors.push({ strategy: strategy.slug, error: String(e) });
      continue;
    }

    if (!fired) continue;

    // Always save state updates (even if no orders)
    if (fired.stateUpdates.length) {
      try {
        await saveStateUpdates(traderId, fired.strategySlug || strategy.slug, fired.stateUpdates);
        // Update local map so subsequent strategies in this run see fresh state
        for (const u of fired.stateUpdates) stateMap.set(u.key, u.value);
      } catch (e) {
        result.errors.push({ strategy: strategy.slug, error: `state save: ${String(e)}` });
      }
    }

    if (!fired.orders.length) continue;

    result.signals.push({
      strategy: strategy.slug,
      underlying: fired.underlying,
      reason: fired.reason,
    });

    // Place each order in the signal
    for (const spec of fired.orders) {
      try {
        const order = await executeOrder(alpaca, spec);
        result.trades.push({
          strategy: strategy.slug,
          symbol: spec.symbol,
          side: spec.side,
          qty: spec.qty,
        });

        // Record in strategyTrades (always store underlying for options too)
        await db.insert(strategyTrades).values({
          id: crypto.randomUUID(),
          traderId,
          strategySlug: strategy.slug,
          orderId: order.id,
          symbol: spec.underlying,
          side: spec.side,
        });

        await pushToTrader(
          traderId,
          `Engine: ${strategy.name}`,
          `${spec.side.toUpperCase()} ${spec.qty}× ${spec.symbol} — ${fired.reason}`,
        );
      } catch (e) {
        result.errors.push({ strategy: strategy.slug, error: `order ${spec.symbol}: ${String(e)}` });
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
  const all = await getAllTraders();
  const traders = traderType ? all.filter(t => t.type === traderType) : all;
  const results = await Promise.allSettled(
    traders.map(t => runEngineForTrader(t.id, phase)),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<RunResult> => r.status === "fulfilled")
    .map(r => r.value);
}
