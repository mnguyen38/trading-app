/**
 * Fetches the upcoming earnings calendar from Nasdaq's public API.
 * No API key required. Results are cached via Next.js for 1 hour so the
 * engine (which runs every 5 min) doesn't hammer the endpoint.
 *
 * Nasdaq endpoint: GET https://api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD
 */

export type EarningsEvent = {
  symbol: string;
  name: string;
  date: string;         // ISO "YYYY-MM-DD"
  timing: "amc" | "bmo" | "unknown";  // after market close / before market open
  daysUntil: number;
};

type NasdaqRow = {
  symbol?: string;
  name?: string;
  time?: string;        // "After Market Close" | "Before Market Open" | "Time Not Supplied"
};

type NasdaqResponse = {
  data?: {
    rows?: NasdaqRow[];
  };
};

function parseTiming(time?: string): EarningsEvent["timing"] {
  if (!time) return "unknown";
  const t = time.toLowerCase();
  if (t.includes("after")) return "amc";
  if (t.includes("before")) return "bmo";
  return "unknown";
}

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

async function fetchOneDay(date: string): Promise<NasdaqRow[]> {
  try {
    const res = await fetch(
      `https://api.nasdaq.com/api/calendar/earnings?date=${date}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
        },
        // Next.js cache: revalidate every hour so the engine doesn't hit Nasdaq
        // every 5 minutes. Fresh enough for intraday earnings awareness.
        next: { revalidate: 3600 },
      },
    );
    if (!res.ok) return [];
    const json: NasdaqResponse = await res.json();
    return json?.data?.rows ?? [];
  } catch {
    return [];
  }
}

// Covers both micro (options-focused) and macro (quality-hold / swing-trade) watchlists
export const EARNINGS_WATCHLIST = new Set([
  // Micro — liquid options
  "AAPL", "MSFT", "GOOGL", "GOOG", "META", "AMZN", "NFLX", "NVDA",
  "AMD",  "TSLA", "ORCL",  "ADBE", "CRM",  "INTC", "PYPL", "V",
  "MA",   "JPM",  "GS",    "BAC",  "WMT",  "COIN", "SNAP", "PLTR",
  // Macro — quality hold / swing trade
  "JNJ",  "UNH",  "COST",  "HD",   "BA",   "CAT",  "DIS",  "SBUX",
]);

/**
 * Returns earnings events for the next `daysAhead` calendar days,
 * filtered to liquid options symbols in the micro watchlist.
 *
 * Called by:
 *  - The engine signal function (signals.ts) to decide when to enter
 *  - The strategies page (SSR) to display to the user
 */
export async function getUpcomingEarnings(daysAhead = 7): Promise<EarningsEvent[]> {
  const today = new Date();
  const dates: string[] = [];
  for (let i = 0; i <= daysAhead; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(dateStr(d));
  }

  // Fetch all days in parallel (Next.js deduplicates identical fetches in one render)
  const rows = await Promise.all(dates.map(d => fetchOneDay(d)));

  const events: EarningsEvent[] = [];
  for (let i = 0; i < dates.length; i++) {
    for (const row of rows[i]) {
      const symbol = row.symbol?.trim().toUpperCase() ?? "";
      if (!symbol || !EARNINGS_WATCHLIST.has(symbol)) continue;
      events.push({
        symbol,
        name: row.name?.trim() ?? symbol,
        date: dates[i],
        timing: parseTiming(row.time),
        daysUntil: i,
      });
    }
  }

  // Deduplicate (sometimes Nasdaq returns the same ticker twice)
  const seen = new Set<string>();
  return events.filter(e => {
    const key = `${e.symbol}:${e.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Returns only events within the 5-7 day entry window the engine uses
 * for the Earnings IV Crush strategy.
 */
export async function getEarningsInWindow(minDays = 5, maxDays = 7): Promise<EarningsEvent[]> {
  const all = await getUpcomingEarnings(maxDays);
  return all.filter(e => e.daysUntil >= minDays && e.daysUntil <= maxDays);
}
