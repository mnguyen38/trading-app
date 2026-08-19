export type Strategy = {
  slug: string;
  name: string;
  type: "micro" | "macro";
  thesis: string;
  academicBasis: string;
  posture: "long_vol" | "short_vol" | "directional";
  timeHorizon: string;
  instruments: string;
  entrySignal: string;
  buyRules: string[];
  sellRules: string[];
  riskNote: string;
  // Capital allocation
  allocationPct: number;      // recommended % of account equity for this strategy
  maxPositions: number;       // concurrent positions allowed
  perTradeSizing: string;     // how to size each individual trade within the allocation
  exampleTickers: string[];
  optionPreference?: "call" | "put" | "both";
};

// ── Capital allocation summary ────────────────────────────────────────────────
// Micro (User 1): options strategies — long-vol capped at premium,
//   short-vol needs collateral.
//   Vol-Spread Long 20% + VRP Seller 30% + Earnings Crush 15% + VRP Inversion 15%
//   + hard cash 5% + SGOV buffer 15% = 100%
//
//   The 20% buffer is split: 5% hard cash (instant margin protection, never invested)
//   + 15% SGOV/BIL (T-bill ETF, earns ~5% yield, liquidates in 1 trading day).
//   Both scale automatically with equity — as the account grows the buffer grows too.
//
// Macro (User 2): stock/ETF strategies — simpler position-based sizing.
//   5% cash buffer (lower since equities have no margin collateral requirement).
//   Quality Hold 40% + Sector Rotation 30% + Economic Cycle 15% + Swing Trade 10% + cash 5% = 100%

export type BufferConfig = {
  hardCashPct: number;       // literal cash, never invested — instant margin protection
  investedPct: number;       // invested in a liquid near-cash instrument
  investedTicker: string;    // ticker for the near-cash instrument (e.g. SGOV)
  investedTickerName: string;
};

// Returns the buffer breakdown for each trader type.
// Total buffer = hardCashPct + investedPct.
export function bufferConfig(type: "micro" | "macro"): BufferConfig {
  if (type === "micro") {
    return {
      hardCashPct: 5,
      investedPct: 15,
      investedTicker: "SGOV",
      investedTickerName: "SGOV (0-3m T-bills)",
    };
  }
  return {
    hardCashPct: 5,
    investedPct: 0,
    investedTicker: "",
    investedTickerName: "",
  };
}

// Total buffer pct (hard cash + invested)
export function cashBufferPct(type: "micro" | "macro"): number {
  const cfg = bufferConfig(type);
  return cfg.hardCashPct + cfg.investedPct;
}

export const STRATEGIES: Strategy[] = [

  // ── Micro strategies (User 1) ──────────────────────────────────────────────

  {
    slug: "vol-spread-long",
    name: "Vol-Spread Long",
    type: "micro",
    thesis:
      "When implied volatility (IV) falls below a stock's 30-day historical realized volatility (HV), options are statistically underpriced. Goyal & Saretto (2009) showed that a long-straddle portfolio built on this signal earned ~3.9% per month after costs — and the edge comes from vega, not gamma: IV mean-reverts back above HV, lifting the value of your options.",
    academicBasis:
      "Goyal & Saretto (2009), JFE — 'Cross-Section of Expected Option Returns'. The long-vol decile (IV < HV) produced +4.08% vega P&L vs −0.40% gamma+theta P&L monthly. Holding period in the paper is 1 month with monthly rebalancing.",
    posture: "long_vol",
    optionPreference: "both",
    timeHorizon: "3–4 weeks (30–45 DTE contracts)",
    instruments: "Options — ATM straddle (1 call + 1 put, same strike)",
    entrySignal: "IVR < 20% AND current IV is at or below the stock's 30-day HV (check Market Chameleon → IV Rank)",
    allocationPct: 20,
    maxPositions: 4,
    perTradeSizing:
      "Divide the 20% bucket equally across max 4 positions (5% per straddle). Max loss = premium paid, so risk per trade is fully bounded. Example at $100k equity: 20% = $20,000 → $5,000 per straddle. On a $200 stock, one ATM straddle costs ~$800–1,200; this comfortably supports 4–6 contracts per position.",
    buyRules: [
      "Confirm IVR (IV Rank) is below 20 on Market Chameleon or Barchart — options are cheap relative to the stock's recent history",
      "Confirm current IV ≤ 30-day historical vol — the IV-HV spread is negative",
      "Buy an ATM straddle (1 call + 1 put at same strike) with 30–45 days to expiry",
      "The edge is vega: you profit when IV mean-reverts upward, not necessarily from a large price move",
    ],
    sellRules: [
      "Close when IV rises back toward or above the 30-day HV — the mispricing has corrected",
      "Take profit at 25–40% gain on the combined straddle cost",
      "Time stop: close at 21 DTE regardless to avoid accelerating theta decay",
      "Stop loss: close if the straddle loses 30% of its value",
    ],
    riskNote:
      "This is NOT a directional bet — it profits from IV normalising upward. If IV stays suppressed, theta bleeds the position daily. ATM options carry the largest theta drag (Bakshi & Kapadia 2003). Size small and hold no more than 4 concurrent straddles.",
    exampleTickers: [
      "AAPL", "MSFT", "AMZN", "GOOGL", "META",
      "NVDA", "AMD", "ADBE", "CRM", "ORCL",
      "SPY",  "QQQ",  "IWM",  "NFLX", "INTC",
      "MU",   "UBER", "BABA", "V",    "MA",
    ],
  },

  {
    slug: "vrp-premium-seller",
    name: "RSI Reversal",
    type: "micro",
    thesis:
      "Stocks rarely move in one direction forever. RSI (Relative Strength Index) measures momentum on a 0–100 scale: below 30 means oversold (sold too hard, likely to bounce), above 70 means overbought (bought too hard, likely to fade). Buying a call when RSI < 30 or a put when RSI > 70 bets on mean reversion — the stock snapping back toward its average. Near-term ATM options give leveraged exposure to that move.",
    academicBasis:
      "Mean reversion in equity prices is well-documented (Poterba & Summers 1988, De Bondt & Thaler 1985). RSI was developed by Welles Wilder (1978) as a practical implementation of momentum reversal. Option-based implementation concentrates the bet with defined risk: max loss is the premium paid, while a 10–15% snap-back in the stock can return 200–400% on an ATM near-term option.",
    posture: "long_vol",
    optionPreference: "both",
    timeHorizon: "28–45 DTE; exit at +25% gain, −30% stop, or 21 DTE",
    instruments: "Options — buy ATM call (oversold bounce) or ATM put (overbought fade)",
    entrySignal: "RSI(14) < 30 → buy call | RSI(14) > 70 → buy put",
    allocationPct: 25,
    maxPositions: 3,
    perTradeSizing:
      "With 25% of account as the options budget, split across max 3 reversal plays. Size each position so the premium cost ≤ 1% of account equity — this keeps a total wipeout of all 3 to a manageable 3%.",
    buyRules: [
      "RSI(14) < 30: stock is oversold — buy an ATM call expecting a bounce back to the 50MA",
      "RSI(14) > 70: stock is overbought — buy an ATM put expecting a fade to the 50MA",
      "Best when the RSI extreme happens near a major price support or resistance level",
      "Prefer stocks with upcoming catalysts: earnings, product launches, macro events",
    ],
    sellRules: [
      "Take profit at +25% on the option position — RSI reversals can be quick",
      "Cut loss at −30% — if RSI continues extreme, the trade thesis is wrong",
      "Close at 21 DTE regardless — theta decay makes it too expensive to hold",
    ],
    riskNote:
      "RSI can stay extreme for extended periods in strong trends. In a sustained downtrend, RSI < 30 can persist for weeks — buying calls in a bear market is a common mistake. Always check the broader trend (SPY direction) before entering.",
    exampleTickers: [
      "AAPL", "TSLA", "NVDA", "SPY",  "AMZN",
      "META", "MSFT", "GOOGL","NFLX", "AMD",
      "PYPL", "COIN", "SNAP", "PLTR", "MSTR",
      "SOFI", "MARA", "RIVN", "HOOD", "LCID",
    ],
  },

  {
    slug: "earnings-iv-crush",
    name: "Earnings Straddle",
    type: "micro",
    thesis:
      "IV spikes to extreme levels in the week before earnings — the market is paying up for uncertainty. The academic edge is on the SELL side (Jongadsayakul: covered calls earn most when IV is elevated; sellers collect the IV crush). This strategy takes the opposite long side: if the actual earnings move is LARGER than what IV implies, the straddle buyer wins. This is a bet that the market is underestimating how big the move will be. Note: on average the sellers win — but individual earnings can wildly exceed expectations.",
    academicBasis:
      "Jongadsayakul — 'Return Determinants of Option Strategies'. Covered call (i.e. short vol) returns are highest when IV is elevated. This strategy takes the long side of that same trade — lower expected value but unlimited upside if the move exceeds the implied move. Best used to learn why IV crush happens and how options price uncertainty.",
    posture: "long_vol",
    optionPreference: "both",
    timeHorizon: "5–7 days — open 1 week before earnings, close the morning after",
    instruments: "Options — long ATM straddle on weekly expiry right after earnings",
    entrySignal: "Earnings date confirmed within 5–7 days AND pre-earnings IV ≥ 40%",
    allocationPct: 15,
    maxPositions: 3,
    perTradeSizing:
      "With 15% of account as the options budget, max 3 concurrent earnings plays. Each straddle costs the combined ATM call + put premium × 100 shares. The breakeven requires the stock to move more than the combined premium / stock price in percentage terms.",
    buyRules: [
      "Earnings date confirmed within 5–7 days",
      "IV ≥ 40% — pre-earnings premium must be elevated for the setup to make sense",
      "Buy ATM call + ATM put on weekly expiry expiring right after the earnings announcement",
      "Understand the implied move: straddle cost / stock price = what the options expect",
    ],
    sellRules: [
      "Close the morning after earnings — non-negotiable. IV crush happens overnight",
      "If the stock gaps far enough to cover the straddle cost, take profit immediately",
      "If the move is smaller than expected, cut the loss — do not hold to expiry",
    ],
    riskNote:
      "On average this trade LOSES — sellers collect IV crush most of the time. The value is educational: learning how IV spike and crush works, and identifying the rare cases where the move exceeds expectations. Size small.",
    exampleTickers: [
      "AAPL", "MSFT", "GOOGL","META", "AMZN",
      "NFLX", "NVDA", "AMD",  "CRM",  "TSLA",
      "ORCL", "ADBE", "INTC", "PYPL", "V",
      "MA",   "JPM",  "GS",   "BAC",  "WMT",
    ],
  },

  {
    slug: "vrp-inversion-long",
    name: "VRP Inversion Long",
    type: "micro",
    thesis:
      "Most of the time, implied vol exceeds realized vol — options are expensive. But roughly 15% of trading days see a VRP inversion: HV rises above IV, meaning options are actually cheap. Dew-Becker & Giglio document these inversions as a clear warning to stop selling premium. Goyal & Saretto's framework flips: when IV < HV, you want to be long vol. This strategy turns the inversion into a directional entry — buy calls or puts when options are genuinely cheap.",
    academicBasis:
      "Dew-Becker & Giglio — 'The Decline of the Variance Risk Premium'. VRP inversions (HV > IV) occur ~15% of trading days and are the primary risk event for short-vol strategies. Goyal & Saretto (2009) — the long-vol decile (IV < HV) earns positive expected returns via vega mean-reversion.",
    posture: "directional",
    optionPreference: "both",
    timeHorizon: "1–3 weeks until VRP normalises",
    instruments: "Options — long calls (bullish) or long puts (bearish), ATM or one strike OTM",
    entrySignal: "IV has been below 30-day HV for 3+ consecutive sessions (VRP inversion confirmed) AND you have a clear directional catalyst or technical setup",
    allocationPct: 15,
    maxPositions: 3,
    perTradeSizing:
      "With 15% of $100k = $15,000 as an opportunistic pool, size each directional options trade at 1–2% of total equity ($1,000–2,000 max premium per trade). This lets you take 7–15 inversion trades over time without over-concentrating. Example: $1,500 premium per call option buys ~2 contracts on a $200 stock with ATM at $700 per contract.",
    buyRules: [
      "Confirm VRP inversion: IV < 30-day HV on Market Chameleon for 3+ sessions in a row",
      "Pick direction using technical analysis (trend, support/resistance, catalyst) — the signal only confirms options are cheap, not direction",
      "Buy ATM or one-strike OTM calls (bullish) or puts (bearish) with 2–3 weeks to expiry",
      "The edge: buying underpriced vol with a vega tailwind on top of any directional gain",
    ],
    sellRules: [
      "Close when IV rises back above HV — the cheap-vol edge is gone",
      "Take profit at 40–80% gain on the contract",
      "Stop loss: close if the option loses 30% of its value",
      "Time stop: close at 21 DTE regardless",
    ],
    riskNote:
      "Requires BOTH a VRP inversion signal AND a directional view. One alone is not enough. Wrong direction plus a vega tailwind can only partially offset losses. This signal is also your cue to CLOSE any active short-vol positions (VRP Seller, Earnings Crush).",
    exampleTickers: [
      "AAPL", "NVDA", "TSLA", "QQQ",  "SPY",
      "IWM",  "MSFT", "AMD",  "GOOGL","META",
      "AMZN", "NFLX", "SMCI", "PLTR", "COIN",
      "MSTR", "RIVN", "SOFI", "DIS",  "BABA",
    ],
  },

  // ── Macro strategies (User 2) ──────────────────────────────────────────────

  {
    slug: "sector-rotation",
    name: "Sector Rotation",
    type: "macro",
    thesis:
      "Money flows between sectors based on where the economy is in the business cycle and recent price momentum. Rotating into the leading sector ETF each month captures these trends at low cost and with built-in diversification.",
    academicBasis:
      "Moskowitz & Grinblatt (1999) — industry momentum explains a large portion of individual stock momentum and persists over 3–12 months. The 11 SPDR sector ETFs provide clean, tradeable exposure to each cycle phase.",
    posture: "directional",
    timeHorizon: "2–6 weeks (monthly rotation review)",
    instruments: "Sector ETFs — SPDR XL-series and a few thematic ETFs",
    entrySignal: "At the start of each month, rank sector ETFs by 1-month total return. Rotate into top 1–2 only if the new leader outperforms your current hold by >3% and is above its 50-day MA",
    allocationPct: 30,
    maxPositions: 2,
    perTradeSizing:
      "With 30% of $100k = $30,000, hold max 2 sector ETF positions of $15,000 each. Equal-weight. ETFs at $50–250 per share: $15,000 buys 60–300 shares, giving meaningful exposure without over-concentration. Rotate fully (sell 100% of old, buy 100% of new) when the signal flips.",
    buyRules: [
      "Rank these ETFs by 1-month total return: XLK, XLE, XLF, XLV, XLI, XLP, XLU, XLY, XLRE, XLC, XLB",
      "Buy the top 1–2 performers — only rotate if the new leader beats your current hold by >3%",
      "Confirm the ETF is trading above its 50-day MA (trend filter — avoids chasing into a falling sector)",
      "Invest exactly $15,000 per ETF position; rebalance to 50/50 on each monthly review",
    ],
    sellRules: [
      "Rotate out when the ETF falls out of the top 2 at the next monthly review",
      "Exit immediately if the position drops >8% from entry (hard stop loss)",
      "Hold winners as long as they stay in the top tier — don't cut early",
    ],
    riskNote:
      "Sector momentum can reverse sharply on macro surprises. The 1-month lookback is noisy near month-end. Don't rotate more than once per month; whipsaws and transaction costs erode edge.",
    exampleTickers: [
      "XLK",  "XLE",  "XLF",  "XLV",  "XLI",
      "XLP",  "XLU",  "XLY",  "XLRE", "XLC",
      "XLB",  "VGT",  "IBB",  "GDX",  "XOP",
      "ITB",  "XRT",  "SOXX", "XME",  "XHB",
    ],
  },

  {
    slug: "quality-hold",
    name: "Quality Hold",
    type: "macro",
    thesis:
      "Wide-moat companies with durable competitive advantages, consistent earnings growth, and high returns on capital compound wealth over time. The strategy is to build a concentrated portfolio in a few high-quality names and add to them on weakness rather than trading around them.",
    academicBasis:
      "Novy-Marx (2013) — 'The Other Side of Value: The Gross Profitability Premium'. High-quality (profitable) firms earn persistent excess returns. Buffett/Munger framework: moat + reinvestment ability at high returns compounds intrinsic value regardless of short-term noise.",
    posture: "directional",
    timeHorizon: "Weeks to months — hold until thesis breaks",
    instruments: "Individual stocks — large-cap, highly profitable companies",
    entrySignal: "Stock pulls back 10–15% from its 52-week high with no fundamental deterioration in the business",
    allocationPct: 40,
    maxPositions: 5,
    perTradeSizing:
      "With 40% of $100k = $40,000, hold exactly 5 equal-weight positions of $8,000 each. The 5 slots enforce concentration discipline. Add to an existing position (up to 1.5× initial weight = $12,000 max) on 10–15% dips if the thesis remains intact. Never let a single holding exceed 20% of total equity.",
    buyRules: [
      "Target companies with a durable moat: strong brand, network effects, switching costs, or cost advantage",
      "Buy on pullbacks of 10–15% from highs where the business has not deteriorated",
      "Each of the 5 positions is exactly $8,000 at entry — equal weight enforces discipline",
      "Reinvest dividends; trim only when a position exceeds 20% of total equity",
    ],
    sellRules: [
      "Sell only when the investment thesis breaks: moat erodes, margins compress durably, or capital allocation deteriorates",
      "Trim if a single position grows above 20% of total equity (rebalance, not exit)",
      "Do not sell on short-term earnings misses or market panic if the moat is intact",
    ],
    riskNote:
      "Concentration means a single thesis failure hits hard. Monitor moat integrity quarterly via earnings calls, not daily prices. Quality stocks can be expensive and may underperform for extended stretches when valuation matters more than quality.",
    exampleTickers: [
      "AAPL", "MSFT", "GOOGL","AMZN", "META",
      "NVDA", "V",    "MA",   "BRK.B","JNJ",
      "UNH",  "COST", "LLY",  "NVO",  "TSM",
      "ASML", "HD",   "PG",   "KO",   "MCD",
    ],
  },

  {
    slug: "economic-cycle",
    name: "Economic Cycle",
    type: "macro",
    thesis:
      "Different sectors outperform at different stages of the business cycle. Matching your portfolio's sector exposure to the current phase improves risk-adjusted returns by owning what the macro environment structurally favours, not chasing last month's winner.",
    academicBasis:
      "Stovall (1996) — 'Sector Investing'. Classical cycle work shows defensives (staples, utilities, health care) outperform in slowdowns; cyclicals (tech, industrials, discretionary) lead in expansions. Use protective puts as hedges in late-cycle only when IVR is low (Jongadsayakul — puts are cheapest when IV is low).",
    posture: "directional",
    timeHorizon: "1–3 months between regime shifts",
    instruments: "Sector ETFs (stocks for core; protective puts as hedges only when IVR < 20)",
    entrySignal: "Identify cycle phase using: ISM Manufacturing PMI trend, yield curve slope (10Y-2Y), unemployment direction, and Fed policy stance — need 3 of 4 indicators to agree",
    allocationPct: 15,
    maxPositions: 3,
    perTradeSizing:
      "With 15% of $100k = $15,000, hold 2–3 cycle ETFs of $5,000–7,500 each. This is a tilt on top of existing Sector Rotation, so smaller size is intentional. Optional protective puts (when IVR < 20): budget up to $500 per put contract per position — this is a 3% hedge on each $15k ETF block.",
    buyRules: [
      "Expansion (PMI > 50, rising employment): buy XLY (consumer discretionary) + XLI (industrials)",
      "Late-cycle / slowdown (PMI falling, yield curve flattening): rotate to XLP (staples) + XLV (health care)",
      "Contraction (PMI < 50, rising unemployment): hold XLP + XLU (utilities); add OTM protective puts on index when IVR < 20",
      "Recovery (PMI bottoming, Fed easing): accumulate XLK (tech) + XLF (financials) early in the cycle",
    ],
    sellRules: [
      "Rotate to the next phase ETFs when 3 of 4 macro indicators confirm a regime shift",
      "Exit any position that drops >12% before the next review",
      "Keep 15–20% of this bucket in cash to deploy on intra-cycle dips",
    ],
    riskNote:
      "Cycle timing is notoriously difficult — regimes are only obvious in hindsight. Use gradual tilts (not wholesale switches) to reduce whipsaw risk. The yield curve can lead economic activity by 6–18 months, creating painful false signals.",
    exampleTickers: [
      "XLY",  "XLI",  "XLP",  "XLV",  "XLK",
      "XLF",  "XLU",  "XLC",  "XLRE", "XLB",
      "TLT",  "SHY",  "GLD",  "IAU",  "VNQ",
      "IYR",  "DBA",  "UUP",  "PDBC", "CORN",
    ],
  },

  {
    slug: "swing-trade",
    name: "Swing Trade",
    type: "macro",
    thesis:
      "Stocks in established uptrends oscillate between support and resistance. Buying at a well-defined support level and selling at the next resistance 1–3 weeks later captures the swing without requiring perfect timing of tops and bottoms.",
    academicBasis:
      "Jegadeesh & Titman (1993) — medium-term momentum (3–12 months) is persistent. Support/resistance levels reflect supply/demand imbalances that resolve predictably over 1–3 week windows. Protective puts used as hedges only when IVR < 20 — Jongadsayakul showed protective puts are most cost-efficient when IV is low.",
    posture: "directional",
    timeHorizon: "1–3 weeks per trade",
    instruments: "Individual stocks (protective puts as hedges only when IVR < 20)",
    entrySignal: "Stock in uptrend (higher highs + higher lows over 2+ months) pulls back to defined support with RSI between 40–55",
    allocationPct: 10,
    maxPositions: 2,
    perTradeSizing:
      "With 10% of $100k = $10,000, hold max 2 concurrent swing positions of $5,000 each. Required risk/reward ≥ 2:1 before entering (if stop loss is $250 away, target must be $500 away minimum). Optional: spend up to $150 per protective put as downside insurance on each $5,000 position when IVR < 20.",
    buyRules: [
      "Confirm uptrend: higher highs and higher lows on the daily chart over 2+ months",
      "Enter near a support level: prior resistance flipped to support, the 50-day MA, or a key Fibonacci level (38.2–61.8% retracement)",
      "RSI should be 40–55 — not overbought, not oversold; pullback has normalised",
      "Each position is exactly $5,000; required risk/reward ≥ 2:1 before entry",
    ],
    sellRules: [
      "Sell at the next defined resistance level or pre-set price target (at least 2× the stop distance)",
      "Stop loss: just below the support level used to enter (typically 3–5% below entry)",
      "Time stop: reassess if price hasn't moved in 10 trading days — exit if trend is stalling",
    ],
    riskNote:
      "Support levels can fail, especially in sector-wide selloffs unrelated to the individual stock. Always define the stop BEFORE entering, not after. Keep this bucket small (10%) to preserve capital for longer-horizon strategies.",
    exampleTickers: [
      "AAPL", "MSFT", "JPM",  "HD",   "UNH",
      "TSLA", "NVDA", "AMZN", "GS",   "BA",
      "COST", "CAT",  "DE",   "LMT",  "AVGO",
      "MU",   "AMAT", "NOW",  "SNOW", "PANW",
    ],
  },
];

export function strategiesForType(type: "micro" | "macro"): Strategy[] {
  return STRATEGIES.filter(s => s.type === type);
}

export function getStrategy(slug: string): Strategy | undefined {
  return STRATEGIES.find(s => s.slug === slug);
}

