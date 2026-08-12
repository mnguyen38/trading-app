/**
 * Static earnings calendar. Update this list every weekend with the upcoming week's
 * announcements. The engine uses it to know when to enter Earnings IV Crush plays
 * (5-7 calendar days before the reporting date).
 *
 * Source: Earnings Whispers (https://earningswhispers.com) or NASDAQ earnings calendar.
 * Only include tickers that are in the earnings-iv-crush exampleTickers list.
 */

export type EarningsEvent = {
  symbol: string;
  /** ISO date the company REPORTS (e.g. "2025-08-20"). AMC = after market close. BMO = before open. */
  date: string;
  timing: "amc" | "bmo";
};

// ── Update this list every weekend ──────────────────────────────────────────
export const EARNINGS_CALENDAR: EarningsEvent[] = [
  // Example entries (replace with real upcoming dates each week):
  // { symbol: "NVDA", date: "2025-08-27", timing: "amc" },
  // { symbol: "AAPL", date: "2025-10-30", timing: "amc" },
];

/**
 * Returns earnings events where the reporting date is between `minDays` and `maxDays`
 * calendar days from now. The engine enters the play 5-7 days before reporting.
 */
export function getUpcomingEarnings(minDays = 5, maxDays = 7): EarningsEvent[] {
  const now = Date.now();
  return EARNINGS_CALENDAR.filter(e => {
    const daysUntil = (new Date(e.date).getTime() - now) / 86400_000;
    return daysUntil >= minDays && daysUntil <= maxDays;
  });
}
