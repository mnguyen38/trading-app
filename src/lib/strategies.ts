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
    name: "VRP Premium Seller",
    type: "micro",
    thesis:
      "Implied volatility exceeds realised volatility approximately 85% of the time — options are structurally overpriced. Bakshi & Kapadia (2003) proved this by showing delta-hedged call positions earn negative returns on average (option buyers are systematically overpaying for vol). Selling premium collects this 'volatility risk premium' (VRP). Dew-Becker & Giglio document the VRP is positive ~79% of the time for SPY at 30 DTE, though the edge has diminished post-2012.",
    academicBasis:
      "Bakshi & Kapadia (2003), RFS — 'Delta-Hedged Gains and the Negative Market Volatility Risk Premium'. Delta-hedged long calls earn negative returns; the effect is largest for ATM options and in high-RV environments. Dew-Becker & Giglio — 'The Decline of the Variance Risk Premium' — VRP positive ~79% of the time but structural break ~2012 means blind selling is riskier now.",
    posture: "short_vol",
    optionPreference: "both",
    timeHorizon: "30–45 DTE; target exit at 21 DTE or 50% profit",
    instruments: "Options — short strangle (sell OTM call + sell OTM put) or covered call on existing stock",
    entrySignal: "Triple-confirm: IVR ≥ 30, IVP ≥ 50, AND IV exceeds 30-day HV by ≥ 5 volatility points",
    allocationPct: 30,
    maxPositions: 3,
    perTradeSizing:
      "Short strangles need collateral — Alpaca requires ~20% of the underlying stock price per leg as margin. With 30% of $100k = $30,000 as your collateral pool, and a $200 stock needing ~$4,000 margin per strangle, you can safely run 3 concurrent strangles (3 × $10,000 = $30,000 reserved). Aim to collect $500–750 in net premium per strangle (0.5–0.75% of collateral), targeting a 50% profit close.",
    buyRules: [
      "All three conditions: IVR ≥ 30, IVP ≥ 50, IV > HV by ≥ 5 pts — all must be true simultaneously",
      "Sell a strangle: OTM call and OTM put each at ~0.25–0.30 delta, same expiry 30–45 DTE",
      "Check that VRP is NOT negative: if HV > IV, skip this setup entirely",
      "Collect premium — your max profit is the total premium received at entry",
    ],
    sellRules: [
      "Close (buy back) at 50% of premium collected — half profit before gamma risk grows",
      "Close at 21 DTE even if not at 50% profit — gamma accelerates near expiry",
      "Roll or close immediately if the underlying moves within 1 strike of either short leg",
    ],
    riskNote:
      "Short strangles have theoretically unlimited loss on the call side. The post-2012 VRP structural decline (Dew-Becker & Giglio) means this strategy is less reliable than historical studies suggest. Never sell into a VRP inversion (HV > IV).",
    exampleTickers: [
      "AAPL", "TSLA", "NVDA", "SPY",  "AMZN",
      "META", "MSFT", "GOOGL","NFLX", "AMD",
      "PYPL", "COIN", "SNAP", "PLTR", "MSTR",
      "SOFI", "MARA", "RIVN", "HOOD", "LCID",
    ],
  },

  {
    slug: "earnings-iv-crush",
    name: "Earnings IV Crush",
    type: "micro",
    thesis:
      "IV spikes in the week before an earnings announcement as the market prices in uncertainty. After the announcement — regardless of which direction the stock moves — IV collapses back to normal levels instantly ('IV crush'). Jongadsayakul showed covered call returns improve significantly when IV is elevated. Bakshi & Kapadia showed ATM options carry the heaviest overpricing penalty. Selling a short-dated strangle before earnings collects the inflated premium, then buys it back for far less after crush.",
    academicBasis:
      "Jongadsayakul — 'Return Determinants of Option Strategies: Evidence from Protective Put and Covered Call'. Covered call returns are highest when IV is elevated. Bakshi & Kapadia (2003) — ATM options carry the largest negative delta-hedged gain; overpricing is worst at-the-money, precisely where earnings IV spikes concentrate.",
    posture: "short_vol",
    optionPreference: "both",
    timeHorizon: "5–7 days — open 1 week before earnings, close the morning after",
    instruments: "Options — short strangle on weekly expiry right after earnings",
    entrySignal: "Earnings date confirmed within 5–7 days AND IVR > 50% (elevated from the event premium build-up)",
    allocationPct: 15,
    maxPositions: 3,
    perTradeSizing:
      "With 15% of $100k = $15,000 as the collateral pool, run max 3 concurrent earnings plays of $5,000 each. Earnings don't cluster that much, so 2–3 plays per week is realistic. Target $300–500 premium per strangle (6–10% of deployed capital), looking to collect 60–70% of that in IV crush the next morning.",
    buyRules: [
      "Confirm the earnings date (Earnings Whispers or company IR page) is within 5–7 days",
      "Confirm IVR > 50 — IV must already be elevated from the approaching event",
      "Sell weekly options expiring right after the earnings announcement: OTM call + OTM put at ~0.20 delta",
      "Enter 5–7 days before the announcement to collect maximum event premium",
    ],
    sellRules: [
      "Close the position the morning after the earnings announcement — non-negotiable",
      "IV will have crushed overnight; buy back the strangle for 50–70% less than you collected",
      "Do NOT hold to expiry hoping for more — risk/reward flips after IV crush",
      "If stock makes an extreme move (gap beyond your strikes), close at the open immediately",
    ],
    riskNote:
      "Only trade this on large-cap liquid stocks. Never sell earnings strangles on binary-event stocks (FDA approvals, merger votes) where the move is structurally unpredictable. An extreme post-earnings gap can overwhelm the collected premium.",
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

