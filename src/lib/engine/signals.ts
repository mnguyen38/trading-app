import type { AlpacaClient, Position, Bar } from "../alpaca";
import { parseOptionSymbol } from "../alpaca";
import { hv30, rsi, sma, monthReturn, quarterReturn, high52w, lastClose } from "./indicators";
import { estimateIV, selectStraddleContracts, selectStrangleStrikes, selectPostEarningsExpiry } from "./iv";
import { getEarningsInWindow } from "./earningsFetcher";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrderSpec = {
  asset: "stock" | "option";
  symbol: string;
  underlying: string;
  side: "buy" | "sell";
  qty: number;
  orderType: "market" | "bracket";
  takeProfitPrice?: number;
  stopLossPrice?: number;
};

export type SignalFired = {
  strategySlug: string;
  underlying: string;
  reason: string;
  orders: OrderSpec[];
  stateUpdates: { key: string; value: string }[];
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
  positions: Position[];
  tags: { strategySlug: string; symbol: string }[];
  stateMap: Map<string, string>;
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

async function bars(alpaca: AlpacaClient, symbol: string): Promise<Bar[]> {
  try {
    const res = await alpaca.getBars(symbol, "1Day", 260);
    return res.bars ?? [];
  } catch {
    return [];
  }
}

function activeUnderlyings(
  slug: string,
  tags: SignalContext["tags"],
  positions: Position[],
): Set<string> {
  const taggedFor = tags.filter(t => t.strategySlug === slug).map(t => t.symbol.toUpperCase());
  const active = new Set<string>();
  for (const p of positions) {
    const sym = p.symbol.toUpperCase();
    for (const t of taggedFor) {
      if (sym === t || sym.startsWith(t)) { active.add(t); break; }
    }
  }
  return active;
}

// ── Priority watchlists ───────────────────────────────────────────────────────

const MICRO_SCAN: Record<string, string[]> = {
  "vol-spread-long":    ["AAPL", "MSFT", "AMZN", "GOOGL", "NVDA", "META", "TSLA", "AMD"],
  "vrp-premium-seller": ["AAPL", "TSLA", "NVDA",  "SPY",  "AMZN", "META", "MSFT", "GOOGL"],
  "vrp-inversion-long": ["AAPL", "NVDA",  "TSLA",  "QQQ",  "SPY", "MSFT",  "AMD", "GOOGL"],
};

const SECTOR_ETFS    = ["XLK", "XLE", "XLF", "XLV", "XLI", "XLP", "XLU", "XLY", "XLRE", "XLC", "XLB"];
const QUALITY_STOCKS = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "V", "JNJ", "UNH", "COST"];
const CYCLE_TICKERS  = ["SPY", "TLT", "XLK", "XLP", "XLU", "XLI", "XLY", "XLF"];
const SWING_STOCKS   = ["AAPL", "MSFT", "JPM", "HD", "UNH", "TSLA", "NVDA", "AMZN", "GS", "BA"];

// ── Micro: Vol-Spread Long ────────────────────────────────────────────────────
// Goyal & Saretto 2009: long straddle when IV < HV30.

export async function signalVolSpreadLong(ctx: SignalContext): Promise<SignalResult> {
  const slug = "vol-spread-long";
  const log: string[] = [];
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);
  const scan = MICRO_SCAN[slug].filter(t => !busy.has(t));

  if (!scan.length) {
    return { fired: null, log: [`All ${MICRO_SCAN[slug].length} tickers already held — at max positions`] };
  }

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

    // IV < HV — candidate. Try to get contracts.
    const straddle = await selectStraddleContracts(ctx.alpaca, sym, price);
    if (!straddle) {
      log.push(`${sym}: IV ${ivEst.iv.toFixed(1)}% < HV30 ${hv.toFixed(1)}% ✓ but no ATM straddle contracts available`);
      continue;
    }

    const straddleCost = ivEst.straddle * 100;
    const qty = Math.max(1, Math.floor(ctx.perPositionBudget / straddleCost));
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

// ── Micro: VRP Premium Seller ─────────────────────────────────────────────────
// Bakshi & Kapadia 2003: sell OTM strangle when IV > HV + 5pts.

export async function signalVrpPremiumSeller(ctx: SignalContext): Promise<SignalResult> {
  const slug = "vrp-premium-seller";
  const log: string[] = [];
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);
  const scan = MICRO_SCAN[slug].filter(t => !busy.has(t));

  if (!scan.length) {
    return { fired: null, log: [`All ${MICRO_SCAN[slug].length} tickers already held — at max positions`] };
  }

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

    const spread = ivEst.iv - hv;
    if (spread < 5) {
      log.push(`${sym}: IV ${ivEst.iv.toFixed(1)}% − HV30 ${hv.toFixed(1)}% = ${spread.toFixed(1)}pt — need ≥5pt VRP to sell premium`);
      continue;
    }

    const strangle = await selectStrangleStrikes(ctx.alpaca, sym, price, ivEst.iv, ivEst.dte);
    if (!strangle) {
      log.push(`${sym}: VRP ${spread.toFixed(1)}pt ✓ but no 25-delta strangle contracts found`);
      continue;
    }

    const reason = `${sym}: IV ${ivEst.iv.toFixed(1)}% − HV30 ${hv.toFixed(1)}% = ${spread.toFixed(1)}pt VRP — selling strangle`;
    log.push(`${sym}: ✓ SIGNAL — ${reason}`);

    return {
      fired: {
        strategySlug: slug, underlying: sym, reason,
        orders: [
          { asset: "option", symbol: strangle.callSymbol, underlying: sym, side: "sell", qty: 1, orderType: "market" },
          { asset: "option", symbol: strangle.putSymbol,  underlying: sym, side: "sell", qty: 1, orderType: "market" },
        ],
        stateUpdates: [],
      },
      log,
    };
  }

  return { fired: null, log };
}

// ── Micro: Earnings IV Crush ──────────────────────────────────────────────────
// Jongadsayakul: sell strangle 5-7 days before earnings, close morning after.

export async function signalEarningsIVCrush(ctx: SignalContext): Promise<SignalResult> {
  const slug = "earnings-iv-crush";
  const log: string[] = [];
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);
  const upcoming = (await getEarningsInWindow(5, 7)).filter(e => !busy.has(e.symbol));

  if (!upcoming.length) {
    log.push("No earnings in the 5–7 day window for watchlist tickers");
    return { fired: null, log };
  }

  for (const event of upcoming) {
    const sym = event.symbol;
    let price = 0;
    try {
      const snap = await ctx.alpaca.getSnapshot(sym);
      price = snap.latestTrade?.p ?? snap.latestQuote?.ap ?? 0;
    } catch {
      log.push(`${sym}: earnings ${event.date} — could not fetch price`);
      continue;
    }

    if (!price) {
      log.push(`${sym}: earnings ${event.date} — price returned 0`);
      continue;
    }

    const ivEst = await estimateIV(ctx.alpaca, sym, price);
    if (!ivEst) {
      log.push(`${sym}: earnings ${event.date} — could not estimate IV (no ATM contracts)`);
      continue;
    }

    if (ivEst.iv < 40) {
      log.push(`${sym}: earnings ${event.date} — IV ${ivEst.iv.toFixed(1)}% < 40% threshold — pre-earnings premium not elevated enough`);
      continue;
    }

    const daysToEvent = Math.ceil((new Date(event.date).getTime() - Date.now()) / 86400_000);
    const contracts = await selectPostEarningsExpiry(ctx.alpaca, sym, daysToEvent + 1);
    if (!contracts) {
      log.push(`${sym}: earnings ${event.date} — IV ${ivEst.iv.toFixed(1)}% ✓ but no post-earnings expiry contracts found`);
      continue;
    }

    const reason = `${sym}: earnings ${event.date} (${event.timing}), IV ${ivEst.iv.toFixed(1)}% ≥ 40% — selling strangle for IV crush`;
    log.push(`${sym}: ✓ SIGNAL — ${reason}`);

    return {
      fired: {
        strategySlug: slug, underlying: sym, reason,
        orders: [
          { asset: "option", symbol: contracts.callSymbol, underlying: sym, side: "sell", qty: 1, orderType: "market" },
          { asset: "option", symbol: contracts.putSymbol,  underlying: sym, side: "sell", qty: 1, orderType: "market" },
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
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);
  const scan = MICRO_SCAN[slug].filter(t => !busy.has(t));

  if (!scan.length) {
    return { fired: null, log: [`All ${MICRO_SCAN[slug].length} tickers already held — at max positions`] };
  }

  const spyBars = await bars(ctx.alpaca, "SPY");
  const spyCloses = spyBars.map(b => b.c);
  const spyAbove50 = lastClose(spyBars) > sma(spyCloses, 50);
  log.push(`SPY direction: ${spyAbove50 ? "above" : "below"} 50MA → favoring ${spyAbove50 ? "calls" : "puts"}`);

  const scanNoSpy = scan.filter(t => t !== "SPY");
  const allBars = await Promise.allSettled(scanNoSpy.map(t => bars(ctx.alpaca, t)));

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
    let streak = stateInt(ctx.stateMap, streakKey);

    if (ivEst && hv > ivEst.iv) {
      streak += 1;
      log.push(`${sym}: HV30 ${hv.toFixed(1)}% > IV ${ivEst.iv.toFixed(1)}% — inversion day ${streak}/3`);
    } else {
      if (!ivEst) {
        log.push(`${sym}: could not estimate IV — streak reset (was ${streak})`);
      } else {
        log.push(`${sym}: HV30 ${hv.toFixed(1)}% ≤ IV ${ivEst.iv.toFixed(1)}% — no inversion, streak reset (was ${streak})`);
      }
      streak = 0;
    }
    stateUpdates.push({ key: streakKey, value: String(streak) });

    if (!tradeResult && streak >= 3) {
      const straddle = await selectStraddleContracts(ctx.alpaca, sym, price);
      if (straddle) {
        const contractSym = spyAbove50 ? straddle.callSymbol : straddle.putSymbol;
        const straddleCost = ivEst ? ivEst.straddle * 100 : price * 0.03 * 100;
        const qty = Math.max(1, Math.floor(ctx.perPositionBudget / straddleCost));
        const reason = `${sym}: HV > IV for 3 sessions — buying ${spyAbove50 ? "call" : "put"} (SPY ${spyAbove50 ? "↑" : "↓"} 50MA)`;
        log.push(`${sym}: ✓ SIGNAL — ${reason}`);
        tradeResult = {
          strategySlug: slug, underlying: sym, reason,
          orders: [{ asset: "option", symbol: contractSym, underlying: sym, side: "buy", qty, orderType: "market" }],
          stateUpdates: [],
        };
        stateUpdates[stateUpdates.length - 1] = { key: streakKey, value: "0" };
      } else {
        log.push(`${sym}: 3-session inversion ✓ but no contracts available to trade`);
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

  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);
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
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);
  const scan = QUALITY_STOCKS.filter(t => !busy.has(t));

  if (!scan.length) {
    return { fired: null, log: [`All ${QUALITY_STOCKS.length} quality stocks already held — at max positions`] };
  }

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
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);

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
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);
  const scan = SWING_STOCKS.filter(t => !busy.has(t));

  if (!scan.length) {
    return { fired: null, log: [`All ${SWING_STOCKS.length} swing candidates already held — at max positions`] };
  }

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

export function checkMicroExits(
  positions: Position[],
  tags: SignalContext["tags"],
): ExitFired[] {
  const longVol  = new Set(["vol-spread-long", "vrp-inversion-long"]);
  const shortVol = new Set(["vrp-premium-seller", "earnings-iv-crush"]);
  const exits: ExitFired[] = [];

  for (const pos of positions) {
    if (pos.asset_class !== "us_option") continue;
    const underlying = pos.symbol.slice(0, pos.symbol.search(/\d/));
    const tag = tags.find(t => t.symbol === underlying || t.symbol === pos.symbol);
    if (!tag) continue;

    const plpc = parseFloat(pos.unrealized_plpc);
    const parsed = parseOptionSymbol(pos.symbol);
    const dte = parsed
      ? Math.max(0, Math.round((new Date(parsed.expiry).getTime() - Date.now()) / 86400_000))
      : 999;

    let why: string | null = null;

    if (longVol.has(tag.strategySlug)) {
      if (plpc >=  0.25) why = `+${(plpc * 100).toFixed(0)}% — profit target hit`;
      if (plpc <= -0.30) why = `${(plpc * 100).toFixed(0)}% — stop loss hit`;
      if (dte   <  21)   why = why ?? `${dte} DTE — entering theta decay zone`;
    } else if (shortVol.has(tag.strategySlug)) {
      if (pos.side === "short" && plpc >= 0.50) why = `50% of premium collected — profit target`;
      if (dte < 21) why = why ?? `${dte} DTE — gamma risk too high`;
    }

    if (why) exits.push({ positionSymbol: pos.symbol, underlying, strategySlug: tag.strategySlug, reason: why });
  }
  return exits;
}
