export type ConceptTier = 1 | 2 | 3;

export type Concept = {
  tier: ConceptTier;
  label: string;
  short: string;
  example: string;
  learnMore?: string;
};

export const CONCEPTS = {
  // ----- Order types -----
  "market-order": {
    tier: 1,
    label: "Market Order",
    short: "Buys or sells immediately at the best available price.",
    example: "You place a market buy on AAPL. It fills in milliseconds at whatever the current ask price is — you get speed, not price control.",
  },
  "limit-order": {
    tier: 1,
    label: "Limit Order",
    short: "Only fills at your price or better.",
    example: "AAPL is at $205. You set a limit buy at $200. The order sits open and only fills if the price drops to $200 or below.",
    learnMore: "limit-vs-market",
  },
  "stop-order": {
    tier: 1,
    label: "Stop Order",
    short: "Becomes a market order once a trigger price is hit.",
    example: "You own AAPL at $200 and set a stop sell at $185. If it drops to $185, your order triggers and sells at whatever price is next.",
  },
  "stop-limit-order": {
    tier: 2,
    label: "Stop-Limit Order",
    short: "Like a stop order, but converts to a limit instead of a market order.",
    example: "Stop at $185, limit at $183. When AAPL hits $185 the order activates — but it only fills at $183 or better, not at any price.",
    learnMore: "limit-vs-market",
  },
  "time-in-force": {
    tier: 1,
    label: "Time in Force",
    short: "How long an order stays open before it's cancelled.",
    example: "'Day' orders expire at market close. 'GTC' (Good Till Cancelled) stays open until you cancel it or it fills.",
  },
  "gtc": {
    tier: 1,
    label: "GTC",
    short: "Good Till Cancelled — the order stays open across multiple trading days.",
    example: "You place a limit buy at $150. With GTC it waits days or weeks until the price comes to you. Without it the order cancels at 4pm.",
  },

  // ----- Position & P&L -----
  "unrealized-pl": {
    tier: 1,
    label: "Unrealized P&L",
    short: "Your paper gain or loss — what you'd make if you sold right now.",
    example: "You bought 10 AAPL at $190. It's now $200. Unrealized P&L = +$100. It becomes 'realized' only when you sell.",
    learnMore: "pnl",
  },
  "realized-pl": {
    tier: 1,
    label: "Realized P&L",
    short: "The actual profit or loss locked in after closing a position.",
    example: "You bought AAPL at $190 and sold at $210. Realized P&L = +$200. It's real — it's in your cash balance now.",
    learnMore: "pnl",
  },
  "avg-entry-price": {
    tier: 1,
    label: "Avg Entry Price",
    short: "The average price you paid per share across all your buys.",
    example: "You bought 5 AAPL at $190 and 5 more at $200. Avg entry = $195. P&L is calculated from this number.",
  },
  "market-value": {
    tier: 1,
    label: "Market Value",
    short: "What your position is worth right now at current prices.",
    example: "10 shares of AAPL at $205 each = $2,050 market value.",
  },
  "long": {
    tier: 1,
    label: "Long",
    short: "You own the asset and profit when it goes up.",
    example: "Buying 10 AAPL makes you 'long AAPL.' You want the price to rise.",
  },
  "short": {
    tier: 3,
    label: "Short",
    short: "Borrowing shares to sell now, hoping to buy them back cheaper later.",
    example: "You short 10 AAPL at $200. If it drops to $180 you buy back and pocket $200 profit. If it rises you lose money.",
    learnMore: "shorting",
  },

  // ----- Account -----
  "buying-power": {
    tier: 1,
    label: "Buying Power",
    short: "How much you can spend on new trades right now.",
    example: "Cash balance + any margin available. With a $10k cash account and no margin your buying power is $10k.",
  },
  "equity": {
    tier: 1,
    label: "Equity",
    short: "Total portfolio value — cash plus the current market value of all positions.",
    example: "$5,000 cash + $5,000 in open positions = $10,000 equity.",
  },
  "cash": {
    tier: 1,
    label: "Cash",
    short: "Uninvested dollars in your account.",
    example: "You deposit $10k and buy $6k of stock. Your cash is $4k. It earns nothing until deployed.",
  },
  "portfolio-value": {
    tier: 1,
    label: "Portfolio Value",
    short: "The total worth of everything in your account.",
    example: "Cash + all positions at current prices. This is the number that matters for tracking your overall performance.",
  },

  // ----- Market concepts -----
  "bid-ask": {
    tier: 1,
    label: "Bid / Ask",
    short: "Bid is what buyers will pay; ask is what sellers want. You pay the ask when buying.",
    example: "AAPL bid $199.95, ask $200.05. If you place a market buy you pay $200.05. The $0.10 difference is the spread.",
    learnMore: "bid-ask-spread",
  },
  "spread": {
    tier: 1,
    label: "Spread",
    short: "The gap between the bid and ask price — a hidden cost on every trade.",
    example: "Bid $199.95, ask $200.05 → spread is $0.10. On 100 shares that's $10 out of pocket just to open and close.",
  },
  "market-hours": {
    tier: 1,
    label: "Market Hours",
    short: "NYSE and NASDAQ trade 9:30am–4:00pm ET, Monday–Friday.",
    example: "Outside these hours you can still place orders — they'll queue for the next open. Some brokers allow pre/after-hours trading at wider spreads.",
  },
  "fractional-shares": {
    tier: 1,
    label: "Fractional Shares",
    short: "Owning less than one full share — lets you invest any dollar amount.",
    example: "NVDA at $900. You invest $100 and get 0.111 shares. You participate in price moves proportionally.",
    learnMore: "fractional-shares",
  },
  "volume": {
    tier: 1,
    label: "Volume",
    short: "How many shares traded today. High volume = more liquid, easier to buy and sell.",
    example: "AAPL might trade 60 million shares in a day. A small-cap stock might trade 10,000. Low volume means your order might move the price.",
  },
  "volatility": {
    tier: 2,
    label: "Volatility",
    short: "How much a stock's price swings. High volatility = bigger moves, more risk and reward.",
    example: "A stock that moves 5% a day is more volatile than one that moves 0.5%. Volatile stocks can make you or lose you money fast.",
  },

  // ----- Chart -----
  "candlestick": {
    tier: 1,
    label: "Candlestick",
    short: "A chart bar showing open, high, low, and close for a time period.",
    example: "Green candle = price closed higher than it opened. Red = closed lower. The 'wick' shows the high and low extremes.",
  },
  "support-resistance": {
    tier: 2,
    label: "Support & Resistance",
    short: "Price levels where buying (support) or selling (resistance) tends to cluster.",
    example: "AAPL keeps bouncing off $190 — that's support. It keeps failing to break $210 — that's resistance.",
  },

  // ----- Advanced -----
  "pe-ratio": {
    tier: 2,
    label: "P/E Ratio",
    short: "Price divided by earnings per share — a rough measure of how expensive a stock is.",
    example: "P/E of 30 means you're paying $30 for every $1 of annual earnings. The S&P 500 average is ~20-25. High P/E = high growth expectations.",
    learnMore: "valuation-basics",
  },
  "market-cap": {
    tier: 1,
    label: "Market Cap",
    short: "Total value of all shares — how big the company is.",
    example: "AAPL at $200/share × 15 billion shares = $3 trillion market cap. This makes it one of the largest companies in the world.",
  },
  "dividend": {
    tier: 2,
    label: "Dividend",
    short: "A cash payment companies make to shareholders, usually quarterly.",
    example: "You own 100 shares of KO (Coca-Cola). They pay a $0.46/share quarterly dividend — you get $46 deposited automatically.",
  },
  "paper-trading": {
    tier: 1,
    label: "Paper Trading",
    short: "Simulated trading with fake money — all the risk, none of the loss.",
    example: "This app uses Alpaca paper trading. Every trade you make is real in every way except the dollars. Great for learning without stakes.",
  },
} as const satisfies Record<string, Concept>;

export type ConceptId = keyof typeof CONCEPTS;

export function getConcept(id: ConceptId): Concept {
  return CONCEPTS[id];
}
