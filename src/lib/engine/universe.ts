/**
 * Ticker universes for the pre-market scanner.
 * Curated to stocks/ETFs with deep, liquid options markets and sufficient
 * daily volume to produce reliable technical signals.
 */

// Micro universe — options-focused. All names here have open interest > 1k
// across multiple strikes and expirations on a typical trading day.
export const MICRO_UNIVERSE = [
  // Mega-cap tech (highest options volume in the market)
  "AAPL", "MSFT", "GOOGL", "META", "AMZN", "NVDA", "TSLA", "AMD",
  // Mid-large tech
  "INTC", "ORCL", "CRM", "ADBE", "NFLX", "PYPL", "COIN", "PLTR",
  "UBER", "NET", "CRWD", "PANW", "SNOW", "DDOG", "MDB", "ZS",
  "RBLX", "HOOD", "ABNB", "SHOP", "SQ", "MSTR",
  // Financials
  "JPM", "BAC", "GS", "MS", "C", "WFC", "V", "MA", "AXP", "BLK",
  // Healthcare / biotech (high IV around catalysts)
  "JNJ", "UNH", "PFE", "MRNA", "ABBV", "LLY", "AMGN", "GILD",
  "REGN", "BIIB", "BMY",
  // Consumer / retail
  "WMT", "COST", "HD", "MCD", "SBUX", "NKE", "DIS", "TGT",
  // Energy
  "XOM", "CVX", "OXY", "COP", "SLB",
  // Industrial
  "BA", "CAT", "GE", "HON", "RTX", "LMT",
  // Broad-market ETFs with liquid options
  "SPY", "QQQ", "IWM", "GLD", "TLT",
];

// Macro universe — equity names for quality-hold and swing-trade signals.
// Sector ETFs are kept separate (they're fixed by definition for rotation/cycle).
export const MACRO_EQUITY_UNIVERSE = [
  // Wide-moat quality names
  "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "V", "MA",
  "JNJ", "UNH", "COST", "HD", "MCD", "WMT", "NKE", "SBUX",
  "JPM", "BAC", "GS", "XOM", "CVX", "LLY", "ABBV", "AMGN",
  "BRK-B", "PG", "KO", "PEP", "TMO", "ABT",
  // Swing-trade candidates (higher beta, clear trend patterns)
  "TSLA", "AMD", "NVDA", "NFLX", "CRM", "ADBE", "ORCL",
  "BA", "CAT", "GE", "HON", "RTX",
  "JPM", "GS", "MS", "AXP",
  "OXY", "COP", "SLB",
];

// Deduplicated version (used when you need a clean unique set)
export const MACRO_EQUITY_UNIVERSE_UNIQUE = [...new Set(MACRO_EQUITY_UNIVERSE)];
