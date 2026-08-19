/**
 * Pre-market ticker scanner.
 *
 * Runs once before market open (~9:00 AM ET) and writes a ranked shortlist
 * to scanner_cache. The engine's signal functions then pull from this cache
 * instead of scanning a static 8-ticker watchlist.
 *
 * Micro scoring  — ranks by HV30 (high realized vol = interesting for options)
 *                  with a bonus for upcoming earnings proximity.
 * Macro scoring  — two ranked lists:
 *                    "dip"      — quality names 10–30% below 52w high
 *                    "momentum" — names with positive 1m return above 50MA
 */

import { db } from "@/src/db/client";
import { scannerCache } from "@/src/db/schema";
import { eq, desc } from "drizzle-orm";
import type { AlpacaClient, Bar } from "../alpaca";
import { hv30, sma, monthReturn, lastClose, high52w } from "./indicators";
import { getUpcomingEarnings } from "./earningsFetcher";
import { MICRO_UNIVERSE, MACRO_EQUITY_UNIVERSE_UNIQUE } from "./universe";

export type ScanEntry = {
  symbol:   string;
  score:    number;        // higher = more interesting
  reason:   string;        // human-readable explanation
  category: string;        // "high-vol" | "earnings" | "dip" | "momentum"
  hv30?:    number;
  drawdown?: number;
  monthRet?: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchBarsParallel(
  alpaca: AlpacaClient,
  symbols: string[],
): Promise<Map<string, Bar[]>> {
  const results = await Promise.allSettled(
    symbols.map(s => alpaca.getBars(s, "1Day", 260)),
  );
  const map = new Map<string, Bar[]>();
  for (let i = 0; i < symbols.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled" && r.value.bars?.length >= 31) {
      map.set(symbols[i], r.value.bars);
    }
  }
  return map;
}

// ── Micro scanner ─────────────────────────────────────────────────────────────

export async function runMicroScan(alpaca: AlpacaClient): Promise<ScanEntry[]> {
  const [barsMap, earnings] = await Promise.all([
    fetchBarsParallel(alpaca, MICRO_UNIVERSE),
    getUpcomingEarnings(30).catch(() => []),
  ]);

  const earningsSymbols = new Map<string, number>(earnings.map(e => [e.symbol, e.daysUntil] as [string, number]));
  const entries: ScanEntry[] = [];

  for (const [symbol, bars] of barsMap) {
    const hv = hv30(bars);
    if (isNaN(hv)) continue;

    const price = lastClose(bars);
    if (!price || price < 10) continue;

    // Base score = HV30 (most volatile names surface first)
    let score = hv;
    let category: ScanEntry["category"] = "high-vol";
    let reason = `HV30 ${hv.toFixed(1)}%`;

    // Earnings proximity bonus — pre-earnings IV inflation is the edge
    const daysUntil = earningsSymbols.get(symbol);
    if (daysUntil !== undefined) {
      const bonus = daysUntil <= 7 ? 30 : daysUntil <= 14 ? 15 : 5;
      score += bonus;
      category = "earnings";
      reason += ` · earnings in ${daysUntil}d (+${bonus}pt bonus)`;
    }

    entries.push({ symbol, score, reason, category, hv30: hv });
  }

  // Sort by score descending, return top 40
  entries.sort((a, b) => b.score - a.score);
  return entries.slice(0, 40);
}

// ── Macro scanner ─────────────────────────────────────────────────────────────

export async function runMacroScan(alpaca: AlpacaClient): Promise<ScanEntry[]> {
  const barsMap = await fetchBarsParallel(alpaca, MACRO_EQUITY_UNIVERSE_UNIQUE);
  const entries: ScanEntry[] = [];

  for (const [symbol, bars] of barsMap) {
    if (bars.length < 60) continue;

    const price   = lastClose(bars);
    const h52     = high52w(bars);
    const closes  = bars.map(b => b.c);
    const ma50    = sma(closes, 50);
    const ret1m   = monthReturn(bars);

    if (!price || !h52 || isNaN(ma50) || isNaN(ret1m)) continue;
    if (price < 10) continue;

    const drawdown = (h52 - price) / h52;

    // Dip candidate: quality name 10–30% off 52w high
    if (drawdown >= 0.10 && drawdown <= 0.30) {
      // Score peaks at 15% drawdown — sweet spot between "cheap enough" and "not broken"
      const dipScore = 100 - Math.abs(drawdown * 100 - 15) * 2;
      entries.push({
        symbol,
        score:    Math.max(0, dipScore),
        reason:   `${(drawdown * 100).toFixed(1)}% below 52w high $${h52.toFixed(0)}`,
        category: "dip",
        drawdown,
      });
      continue;
    }

    // Momentum candidate: positive 1m return, above 50MA (uptrend)
    if (ret1m > 0.02 && price > ma50) {
      const momScore = ret1m * 100; // e.g. 8% return → score 8
      entries.push({
        symbol,
        score:    momScore,
        reason:   `+${(ret1m * 100).toFixed(1)}% 1m return, above 50MA ($${ma50.toFixed(0)})`,
        category: "momentum",
        monthRet: ret1m,
      });
    }
  }

  // Sort each category independently, then interleave top picks
  const dips = entries.filter(e => e.category === "dip")
    .sort((a, b) => b.score - a.score).slice(0, 20);
  const momentum = entries.filter(e => e.category === "momentum")
    .sort((a, b) => b.score - a.score).slice(0, 15);

  return [...dips, ...momentum];
}

// ── DB persistence ────────────────────────────────────────────────────────────

export async function saveScanResults(
  traderType: "micro" | "macro",
  tickers: ScanEntry[],
) {
  await db.insert(scannerCache).values({
    id:         crypto.randomUUID(),
    traderType,
    tickers:    tickers as unknown as Record<string, unknown>[],
    scannedAt:  new Date(),
  });
}

export async function loadScanList(
  traderType: "micro" | "macro",
): Promise<string[] | null> {
  const rows = await db
    .select()
    .from(scannerCache)
    .where(eq(scannerCache.traderType, traderType))
    .orderBy(desc(scannerCache.scannedAt))
    .limit(1);

  if (!rows.length) return null;

  const tickers = rows[0].tickers as ScanEntry[];
  const cutoff  = Date.now() - 24 * 60 * 60 * 1000; // stale after 24h
  if (new Date(rows[0].scannedAt).getTime() < cutoff) return null;

  return tickers.map(t => t.symbol);
}

export async function loadScanEntries(
  traderType: "micro" | "macro",
): Promise<ScanEntry[]> {
  const rows = await db
    .select()
    .from(scannerCache)
    .where(eq(scannerCache.traderType, traderType))
    .orderBy(desc(scannerCache.scannedAt))
    .limit(1);

  if (!rows.length) return [];
  return rows[0].tickers as ScanEntry[];
}
