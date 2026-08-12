import type { AlpacaClient, Position, Bar } from "../alpaca";
import { parseOptionSymbol } from "../alpaca";
import { hv30, rsi, sma, monthReturn, quarterReturn, high52w, lastClose } from "./indicators";
import { estimateIV, selectStraddleContracts, selectStrangleStrikes, selectPostEarningsExpiry } from "./iv";
import { getEarningsInWindow } from "./earningsFetcher";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrderSpec = {
  asset: "stock" | "option";
  symbol: string;         // contract symbol for options, ticker for stocks
  underlying: string;     // always the root stock/ETF ticker
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

// Returns the set of underlying symbols that already have an open Alpaca position
// tagged to this strategy (prevents doubling up on the same name).
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
      if (sym === t || sym.startsWith(t)) {
        active.add(t);
        break;
      }
    }
  }
  return active;
}

// ── Priority watchlists ───────────────────────────────────────────────────────
// Tickers with the deepest, most liquid options markets — essential for reliable
// IV estimation and tight bid-ask spreads on every leg.

const MICRO_SCAN: Record<string, string[]> = {
  "vol-spread-long":    ["AAPL", "MSFT", "AMZN", "GOOGL", "NVDA", "META", "TSLA", "AMD"],
  "vrp-premium-seller": ["AAPL", "TSLA", "NVDA",  "SPY",  "AMZN", "META", "MSFT", "GOOGL"],
  "vrp-inversion-long": ["AAPL", "NVDA",  "TSLA",  "QQQ",  "SPY", "MSFT",  "AMD", "GOOGL"],
};

const SECTOR_ETFS   = ["XLK", "XLE", "XLF", "XLV", "XLI", "XLP", "XLU", "XLY", "XLRE", "XLC", "XLB"];
const QUALITY_STOCKS = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "V", "JNJ", "UNH", "COST"];
const CYCLE_TICKERS  = ["SPY", "TLT", "XLK", "XLP", "XLU", "XLI", "XLY", "XLF"];
const SWING_STOCKS   = ["AAPL", "MSFT", "JPM", "HD", "UNH", "TSLA", "NVDA", "AMZN", "GS", "BA"];

// ── Micro: Vol-Spread Long ────────────────────────────────────────────────────
// Goyal & Saretto 2009: long straddle when IV < HV30.

export async function signalVolSpreadLong(ctx: SignalContext): Promise<SignalFired | null> {
  const slug = "vol-spread-long";
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);
  const scan = MICRO_SCAN[slug].filter(t => !busy.has(t));
  if (!scan.length) return null;

  const allBars = await Promise.allSettled(scan.map(t => bars(ctx.alpaca, t)));

  for (let i = 0; i < scan.length; i++) {
    const sym = scan[i];
    const b = allBars[i];
    if (b.status !== "fulfilled" || b.value.length < 31) continue;

    const hv = hv30(b.value);
    const price = lastClose(b.value);
    if (isNaN(hv) || !price) continue;

    const ivEst = await estimateIV(ctx.alpaca, sym, price);
    if (!ivEst || ivEst.iv >= hv) continue;         // IV not cheaper than realised vol

    const straddle = await selectStraddleContracts(ctx.alpaca, sym, price);
    if (!straddle) continue;

    const straddleCost = ivEst.straddle * 100;       // per contract (100 shares)
    const qty = Math.max(1, Math.floor(ctx.perPositionBudget / straddleCost));

    return {
      strategySlug: slug, underlying: sym,
      reason: `${sym}: IV ${ivEst.iv.toFixed(1)}% < HV30 ${hv.toFixed(1)}% — straddle underpriced`,
      orders: [
        { asset: "option", symbol: straddle.callSymbol, underlying: sym, side: "buy", qty, orderType: "market" },
        { asset: "option", symbol: straddle.putSymbol,  underlying: sym, side: "buy", qty, orderType: "market" },
      ],
      stateUpdates: [],
    };
  }
  return null;
}

// ── Micro: VRP Premium Seller ─────────────────────────────────────────────────
// Bakshi & Kapadia 2003 + Dew-Becker & Giglio: sell OTM strangle when IV > HV + 5pts.

export async function signalVrpPremiumSeller(ctx: SignalContext): Promise<SignalFired | null> {
  const slug = "vrp-premium-seller";
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);
  const scan = MICRO_SCAN[slug].filter(t => !busy.has(t));
  if (!scan.length) return null;

  const allBars = await Promise.allSettled(scan.map(t => bars(ctx.alpaca, t)));

  for (let i = 0; i < scan.length; i++) {
    const sym = scan[i];
    const b = allBars[i];
    if (b.status !== "fulfilled" || b.value.length < 31) continue;

    const hv = hv30(b.value);
    const price = lastClose(b.value);
    if (isNaN(hv) || !price) continue;

    const ivEst = await estimateIV(ctx.alpaca, sym, price);
    if (!ivEst || ivEst.iv - hv < 5) continue;      // VRP must be meaningful (≥5pts)

    const strangle = await selectStrangleStrikes(ctx.alpaca, sym, price, ivEst.iv, ivEst.dte);
    if (!strangle) continue;

    return {
      strategySlug: slug, underlying: sym,
      reason: `${sym}: IV ${ivEst.iv.toFixed(1)}% > HV30 ${hv.toFixed(1)}% + 5pts — selling strangle`,
      orders: [
        { asset: "option", symbol: strangle.callSymbol, underlying: sym, side: "sell", qty: 1, orderType: "market" },
        { asset: "option", symbol: strangle.putSymbol,  underlying: sym, side: "sell", qty: 1, orderType: "market" },
      ],
      stateUpdates: [],
    };
  }
  return null;
}

// ── Micro: Earnings IV Crush ──────────────────────────────────────────────────
// Jongadsayakul: sell strangle 5-7 days before earnings, close morning after.

export async function signalEarningsIVCrush(ctx: SignalContext): Promise<SignalFired | null> {
  const slug = "earnings-iv-crush";
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);
  const upcoming = (await getEarningsInWindow(5, 7)).filter(e => !busy.has(e.symbol));
  if (!upcoming.length) return null;

  for (const event of upcoming) {
    const sym = event.symbol;
    let price = 0;
    try {
      const snap = await ctx.alpaca.getSnapshot(sym);
      price = snap.latestTrade?.p ?? snap.latestQuote?.ap ?? 0;
    } catch { continue; }
    if (!price) continue;

    const ivEst = await estimateIV(ctx.alpaca, sym, price);
    // Require IV ≥ 40% as proxy for pre-earnings premium build-up
    if (!ivEst || ivEst.iv < 40) continue;

    const daysToEvent = Math.ceil((new Date(event.date).getTime() - Date.now()) / 86400_000);
    const contracts = await selectPostEarningsExpiry(ctx.alpaca, sym, daysToEvent + 1);
    if (!contracts) continue;

    return {
      strategySlug: slug, underlying: sym,
      reason: `${sym}: earnings ${event.date}, IV ${ivEst.iv.toFixed(1)}% — sell strangle for IV crush`,
      orders: [
        { asset: "option", symbol: contracts.callSymbol, underlying: sym, side: "sell", qty: 1, orderType: "market" },
        { asset: "option", symbol: contracts.putSymbol,  underlying: sym, side: "sell", qty: 1, orderType: "market" },
      ],
      stateUpdates: [],
    };
  }
  return null;
}

// ── Micro: VRP Inversion Long ─────────────────────────────────────────────────
// Dew-Becker & Giglio: buy directional options when HV > IV for 3+ sessions.

export async function signalVrpInversionLong(ctx: SignalContext): Promise<SignalFired | null> {
  const slug = "vrp-inversion-long";
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);
  const scan = MICRO_SCAN[slug].filter(t => !busy.has(t));
  if (!scan.length) return null;

  // Market direction: SPY above/below 50MA determines call vs put
  const spyBars = await bars(ctx.alpaca, "SPY");
  const spyCloses = spyBars.map(b => b.c);
  const spyAbove50 = lastClose(spyBars) > sma(spyCloses, 50);

  const allBars = await Promise.allSettled(
    scan.filter(t => t !== "SPY").map(t => bars(ctx.alpaca, t)),
  );
  // Re-insert SPY bars for SPY if it's in the scan list
  const scanNoSpy = scan.filter(t => t !== "SPY");

  const stateUpdates: { key: string; value: string }[] = [];
  let tradeResult: SignalFired | null = null;

  for (let i = 0; i < scanNoSpy.length; i++) {
    const sym = scanNoSpy[i];
    const b = allBars[i];
    const barsData = b.status === "fulfilled" ? b.value : (sym === "SPY" ? spyBars : []);
    if (barsData.length < 31) continue;

    const hv = hv30(barsData);
    const price = lastClose(barsData);
    if (isNaN(hv) || !price) continue;

    const ivEst = await estimateIV(ctx.alpaca, sym, price);
    const streakKey = sk(slug, sym, "streak");
    let streak = stateInt(ctx.stateMap, streakKey);

    if (ivEst && hv > ivEst.iv) {
      streak += 1;
    } else {
      streak = 0;
    }
    stateUpdates.push({ key: streakKey, value: String(streak) });

    // Fire on the first ticker reaching the 3-session threshold
    if (!tradeResult && streak >= 3) {
      const straddle = await selectStraddleContracts(ctx.alpaca, sym, price);
      if (straddle) {
        const contractSym = spyAbove50 ? straddle.callSymbol : straddle.putSymbol;
        const straddleCost = ivEst ? ivEst.straddle * 100 : price * 0.03 * 100;
        const qty = Math.max(1, Math.floor(ctx.perPositionBudget / straddleCost));
        tradeResult = {
          strategySlug: slug, underlying: sym,
          reason: `${sym}: HV > IV for ${streak} sessions — buy ${spyAbove50 ? "call" : "put"} (SPY ${spyAbove50 ? "↑" : "↓"})`,
          orders: [{ asset: "option", symbol: contractSym, underlying: sym, side: "buy", qty, orderType: "market" }],
          stateUpdates: [],
        };
        // Reset this ticker's streak after firing
        stateUpdates[stateUpdates.length - 1] = { key: streakKey, value: "0" };
      }
    }
  }

  if (tradeResult) return { ...tradeResult, stateUpdates };
  if (stateUpdates.length) return { strategySlug: slug, underlying: "", reason: "streak updated", orders: [], stateUpdates };
  return null;
}

// ── Macro: Sector Rotation ────────────────────────────────────────────────────
// Moskowitz & Grinblatt: buy top 1-month momentum ETF if above 50MA. Monthly cooldown.

export async function signalSectorRotation(ctx: SignalContext): Promise<SignalFired | null> {
  const slug = "sector-rotation";

  // One rotation per calendar month maximum
  const lastMonth = stateStr(ctx.stateMap, sk(slug, "", "last_rot_month"));
  const thisMonth = new Date().toISOString().slice(0, 7);
  if (lastMonth === thisMonth) return null;

  const allBars = await Promise.allSettled(SECTOR_ETFS.map(t => bars(ctx.alpaca, t)));
  const ranked: { ticker: string; ret: number; price: number }[] = [];

  for (let i = 0; i < SECTOR_ETFS.length; i++) {
    const b = allBars[i];
    if (b.status !== "fulfilled" || b.value.length < 55) continue;
    const bv = b.value;
    const closes = bv.map(b => b.c);
    const ret = monthReturn(bv);
    const ma50 = sma(closes, 50);
    const price = lastClose(bv);
    // Must be above 50MA (trend filter)
    if (!isNaN(ret) && !isNaN(ma50) && price > ma50) {
      ranked.push({ ticker: SECTOR_ETFS[i], ret, price });
    }
  }
  if (!ranked.length) return null;
  ranked.sort((a, b) => b.ret - a.ret);
  const top = ranked[0];

  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);
  if (busy.has(top.ticker)) return null;     // already in the top ETF, no change

  const orders: OrderSpec[] = [];

  // Sell current holdings for this strategy
  for (const held of busy) {
    const pos = ctx.positions.find(p => p.symbol === held);
    if (pos) orders.push({ asset: "stock", symbol: held, underlying: held, side: "sell", qty: Math.abs(parseFloat(pos.qty)), orderType: "market" });
  }

  // Buy the new leader
  const qty = Math.max(1, Math.floor(ctx.perPositionBudget / top.price));
  orders.push({ asset: "stock", symbol: top.ticker, underlying: top.ticker, side: "buy", qty, orderType: "market" });

  return {
    strategySlug: slug, underlying: top.ticker,
    reason: `Rotate → ${top.ticker} (+${(top.ret * 100).toFixed(1)}% 1m, above 50MA)`,
    orders,
    stateUpdates: [{ key: sk(slug, "", "last_rot_month"), value: thisMonth }],
  };
}

// ── Macro: Quality Hold ───────────────────────────────────────────────────────
// Novy-Marx 2013: buy quality on 10-20% drawdown from 52w high.

export async function signalQualityHold(ctx: SignalContext): Promise<SignalFired | null> {
  const slug = "quality-hold";
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);
  const scan = QUALITY_STOCKS.filter(t => !busy.has(t));
  if (!scan.length) return null;

  const allBars = await Promise.allSettled(scan.map(t => bars(ctx.alpaca, t)));

  for (let i = 0; i < scan.length; i++) {
    const sym = scan[i];
    const b = allBars[i];
    if (b.status !== "fulfilled" || b.value.length < 60) continue;

    const h52 = high52w(b.value);
    const price = lastClose(b.value);
    if (!h52 || !price) continue;

    const drawdown = (h52 - price) / h52;
    if (drawdown < 0.10 || drawdown > 0.20) continue;

    const qty = Math.max(1, Math.floor(ctx.perPositionBudget / price));

    return {
      strategySlug: slug, underlying: sym,
      reason: `${sym}: ${(drawdown * 100).toFixed(1)}% below 52w high $${h52.toFixed(2)} — quality dip`,
      orders: [{ asset: "stock", symbol: sym, underlying: sym, side: "buy", qty, orderType: "market" }],
      stateUpdates: [],
    };
  }
  return null;
}

// ── Macro: Economic Cycle ─────────────────────────────────────────────────────
// Stovall cycle framework via SPY trend + XLK/XLP relative performance.
// Runs weekly (Mondays only).

export async function signalEconomicCycle(ctx: SignalContext): Promise<SignalFired | null> {
  const slug = "economic-cycle";
  if (new Date().getDay() !== 1) return null;   // run Mondays only

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

  if (isNaN(spyMa50) || isNaN(xlkRet) || isNaN(xlpRet)) return null;

  const spyAbove = spyLast > spyMa50;
  const growthLeads = xlkRet > xlpRet;

  let phase: "expansion" | "late" | "contraction" | "recovery";
  if      ( spyAbove &&  growthLeads) phase = "expansion";
  else if ( spyAbove && !growthLeads) phase = "late";
  else if (!spyAbove && (spyQRet ?? 0) < 0) phase = "contraction";
  else                                phase = "recovery";

  const phaseETFs: Record<string, string[]> = {
    expansion:   ["XLK", "XLY"],
    late:        ["XLP", "XLV"],
    contraction: ["XLP", "XLU"],
    recovery:    ["XLK", "XLF"],
  };
  const targets = phaseETFs[phase];
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);

  if (targets.every(t => busy.has(t)) && busy.size === targets.length) return null;

  const orders: OrderSpec[] = [];

  for (const held of busy) {
    if (!targets.includes(held)) {
      const pos = ctx.positions.find(p => p.symbol === held);
      if (pos) orders.push({ asset: "stock", symbol: held, underlying: held, side: "sell", qty: Math.abs(parseFloat(pos.qty)), orderType: "market" });
    }
  }

  for (const target of targets) {
    if (!busy.has(target)) {
      const tb = bm[target] ?? await bars(ctx.alpaca, target);
      const price = lastClose(tb);
      if (!price) continue;
      const qty = Math.max(1, Math.floor(ctx.perPositionBudget / price));
      orders.push({ asset: "stock", symbol: target, underlying: target, side: "buy", qty, orderType: "market" });
    }
  }

  if (!orders.length) return null;

  return {
    strategySlug: slug, underlying: targets[0],
    reason: `Cycle: ${phase} — SPY ${spyAbove ? "↑" : "↓"} 50MA, XLK ${growthLeads ? ">" : "<"} XLP. Buy ${targets.join(" + ")}`,
    orders,
    stateUpdates: [],
  };
}

// ── Macro: Swing Trade ────────────────────────────────────────────────────────
// Jegadeesh & Titman: buy at pullback in uptrend with bracket order (auto-exit).

export async function signalSwingTrade(ctx: SignalContext): Promise<SignalFired | null> {
  const slug = "swing-trade";
  const busy = activeUnderlyings(slug, ctx.tags, ctx.positions);
  const scan = SWING_STOCKS.filter(t => !busy.has(t));
  if (!scan.length) return null;

  const allBars = await Promise.allSettled(scan.map(t => bars(ctx.alpaca, t)));

  for (let i = 0; i < scan.length; i++) {
    const sym = scan[i];
    const b = allBars[i];
    if (b.status !== "fulfilled" || b.value.length < 60) continue;

    const closes = b.value.map(bar => bar.c);
    const price  = lastClose(b.value);
    const ma50   = sma(closes, 50);
    const rsiVal = rsi(closes, 14);

    if (!price || isNaN(ma50) || isNaN(rsiVal)) continue;
    if (price <= ma50) continue;              // must be in uptrend
    if (rsiVal < 40 || rsiVal > 55) continue; // pullback zone

    const qty = Math.max(1, Math.floor(ctx.perPositionBudget / price));

    return {
      strategySlug: slug, underlying: sym,
      reason: `${sym}: above 50MA ($${ma50.toFixed(2)}), RSI ${rsiVal.toFixed(0)} — swing entry`,
      orders: [{
        asset: "stock", symbol: sym, underlying: sym,
        side: "buy", qty, orderType: "bracket",
        takeProfitPrice: parseFloat((price * 1.10).toFixed(2)),
        stopLossPrice:   parseFloat((price * 0.95).toFixed(2)),
      }],
      stateUpdates: [],
    };
  }
  return null;
}

// ── Exit checks ───────────────────────────────────────────────────────────────

/**
 * Scans all open options positions tagged to micro strategies and returns
 * those that should be closed based on P&L + time rules from the papers:
 *
 * Long vol  (vol-spread-long, vrp-inversion-long):
 *   Close at +25% gain, -30% loss, or DTE < 21.
 *
 * Short vol (vrp-premium-seller, earnings-iv-crush):
 *   Close at +50% gain (50% of premium collected) or DTE < 21.
 */
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
      if (plpc >=  0.25) why = `+${(plpc * 100).toFixed(0)}% — profit target`;
      if (plpc <= -0.30) why = `${(plpc * 100).toFixed(0)}% — stop loss`;
      if (dte   <  21)   why = why ?? `${dte} DTE — theta zone`;
    } else if (shortVol.has(tag.strategySlug)) {
      if (pos.side === "short" && plpc >= 0.50) why = `50% profit on short premium`;
      if (dte < 21) why = why ?? `${dte} DTE — gamma risk`;
    }

    if (why) {
      exits.push({ positionSymbol: pos.symbol, underlying, strategySlug: tag.strategySlug, reason: why });
    }
  }
  return exits;
}
