import type { Bar } from "../alpaca";

/**
 * Annualised 30-day historical volatility as a percentage.
 * Requires at least 31 bars. Returns NaN if insufficient data.
 * Formula: std_dev(log_returns_30d) × sqrt(252) × 100
 */
export function hv30(bars: Bar[]): number {
  const slice = bars.slice(-31);
  if (slice.length < 31) return NaN;
  const logR = slice.slice(1).map((b, i) => Math.log(b.c / slice[i].c));
  const mean = logR.reduce((s, r) => s + r, 0) / logR.length;
  const variance = logR.reduce((s, r) => s + (r - mean) ** 2, 0) / (logR.length - 1);
  return Math.sqrt(variance * 252) * 100;
}

/**
 * Wilder RSI over `period` bars (default 14).
 * Requires at least period+1 closes.
 */
export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return NaN;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  let avgGain = changes.slice(0, period).reduce((s, c) => s + Math.max(c, 0), 0) / period;
  let avgLoss = changes.slice(0, period).reduce((s, c) => s + Math.max(-c, 0), 0) / period;
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(changes[i], 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-changes[i], 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Simple moving average of the last `period` values. */
export function sma(values: number[], period: number): number {
  const slice = values.slice(-period);
  if (slice.length < period) return NaN;
  return slice.reduce((s, v) => s + v, 0) / period;
}

/**
 * 21-trading-day (≈1 month) total return as a fraction.
 * e.g. 0.05 = +5%.
 */
export function monthReturn(bars: Bar[]): number {
  if (bars.length < 22) return NaN;
  const slice = bars.slice(-22);
  return slice[slice.length - 1].c / slice[0].c - 1;
}

/**
 * 90-trading-day (≈4 month) total return as a fraction.
 */
export function quarterReturn(bars: Bar[]): number {
  if (bars.length < 91) return NaN;
  const slice = bars.slice(-91);
  return slice[slice.length - 1].c / slice[0].c - 1;
}

/** Highest close over the last 252 bars (≈52 weeks). */
export function high52w(bars: Bar[]): number {
  return bars.slice(-252).reduce((h, b) => Math.max(h, b.c), 0);
}

/** Most recent closing price. */
export function lastClose(bars: Bar[]): number {
  return bars[bars.length - 1]?.c ?? NaN;
}
