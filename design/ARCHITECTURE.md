# Architecture

The shape of the trading app: how data flows, what each piece is for, and the constraints that shaped the decisions.

> **Goal:** Educational paper-trading app starting with 2 users (brother + friend), built to expand to more. Accessible on iPhone and laptop, with inline teaching at every turn. End state is a downloadable app — phased rollout: Next.js web → PWA → Capacitor wrap.

---

## Layered overview

```
┌─────────────────────────────────────────────────────────┐
│  Browser (iPhone app, Chrome/Safari laptop, PWA)        │
│  - Server-rendered HTML + minimal client JS             │
│  - No Alpaca secrets in this layer (ever)               │
└────────────────────────┬────────────────────────────────┘
                         │  HTTPS + signed session cookie
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Next.js (the app)                                      │
│  ┌───────────────────┐   ┌──────────────────────────┐   │
│  │ React Server      │   │ Server Actions           │   │
│  │ Components        │   │ (place/cancel order,     │   │
│  │ (all reads)       │   │  login/logout)           │   │
│  └─────────┬─────────┘   └────────────┬─────────────┘   │
│            └──────────────┬────────────┘                │
│                           ▼                             │
│  ┌──────────────────────────────────────────────────┐   │
│  │ src/lib/  alpaca.ts, traders.ts, auth.ts,        │   │
│  │           teaching.ts, format.ts                 │   │
│  │ src/db/   schema.ts (Drizzle), client.ts         │   │
│  │ src/server/actions/                              │   │
│  └─────────────────────┬────────────────────────────┘   │
└────────────────────────┼────────────────────────────────┘
                         │
        ┌────────────────┼─────────────────┬──────────────┐
        ▼                ▼                 ▼              ▼
┌──────────────┐  ┌──────────────┐  ┌───────────┐  ┌────────────┐
│ Alpaca       │  │ Alpaca       │  │ Alpaca WS │  │ Supabase   │
│ Trading API  │  │ Data API     │  │ (live)    │  │ (Postgres) │
└──────────────┘  └──────────────┘  └───────────┘  └────────────┘
```

---

## Distribution roadmap

1. **Now:** Next.js web app, mobile-responsive. Deployed to Vercel — accessible at a URL on any device (laptop, iPhone, Android).
2. **Soon:** PWA manifest + service worker. Users "install" via Safari "Add to Home Screen" or Chrome "Install app" — full-screen, feels native, no App Store required.
3. **Eventually:** Capacitor wrap → `.ipa` (TestFlight, $99/yr Apple Developer account) + `.apk` (Android sideload). Requires an architectural split: Alpaca keys can't ship in a downloadable bundle, so the Next.js app becomes a separately-deployed backend the Capacitor frontend calls via API.

All architecture choices assume the eventual split: secrets stay server-side, mutations go through clearly-defined boundaries (Server Actions today → REST/RPC when Capacitor arrives).

---

## Routes

```
/login                  passcode entry                no auth
/                       dashboard                     auth required
/trade                  new order, generic
/trade/[symbol]         new order, pre-filled
/positions/[symbol]     position detail + close
/orders                 order history
/leaderboard            all traders side-by-side (scales as users grow)
/learn                  lesson index + glossary
/learn/[topic]          full lesson (MDX)
/api/stream             SSE — live account + market events (phase B)
```

Trader identity flows from a **signed HTTP-only cookie** set at login, not from URL params. Switching trader = log out + log back in.

### Future route additions (post-MVP)
- `/chart/[symbol]` — embedded TradingView chart widget
- `/news` or per-symbol news panel — Yahoo Finance / Alpaca news feed

---

## Auth

Auth is designed to scale beyond 2 users without code changes. Traders are stored in the database (not hardcoded in env vars), so adding a user is a database row, not a deployment.

### Env
```
SESSION_SECRET=<64 random hex chars>
```

### Flow
1. `/login` → user enters passcode → Server Action `login()` queries the `traders` table for a matching passcode → if match, set signed cookie `session={traderId}` (HMAC-SHA256 with `SESSION_SECRET`) → redirect `/`.
2. `middleware.ts` runs on all protected routes → verifies cookie → if missing or invalid → redirect `/login`.
3. Server components / actions call `getSession()` to get the current trader's ID from the cookie.

### Login UI
The `/login` page shows all registered traders by name. The user taps their name, enters their passcode, and the session is set. This pattern scales: adding a third or fourth trader requires only a new database row.

### Passcode storage
Passcodes are stored **hashed** (bcrypt) in the `traders` table. Never in env vars, never in plaintext.

---

## Data flow

### Reads — React Server Components

Page is `async function Page()`. Gets trader from cookie, calls Alpaca, renders HTML server-side. No client fetch code.

```tsx
export default async function Dashboard() {
  const traderId = await getSession();
  const trader = await getTraderById(traderId); // DB lookup
  const alpaca = alpacaForTrader(trader);
  const [account, positions] = await Promise.all([
    alpaca.getAccount(),
    alpaca.getPositions(),
  ]);
  return <DashboardView account={account} positions={positions} />;
}
```

### Mutations — Server Actions

Form submits straight to a Server Action. Works without JS (progressive enhancement). On success, `revalidatePath` rebuilds the page with fresh data.

```tsx
async function placeOrder(input: PlaceOrderInput) {
  'use server';
  const traderId = await getSession();
  const trader = await getTraderById(traderId);
  await alpacaForTrader(trader).placeOrder(input);
  revalidatePath('/');
}
```

### Live updates — phased

**Phase A — polling (ships first):**
`useLiveAccount()` hook polls every 5s while the page is visible, pauses when backgrounded, refreshes on page focus.

**Phase B — true live (drop-in upgrade):**
Server opens SSE at `/api/stream`, bridges to Alpaca's WebSockets (market data + trading events). The same `useLiveAccount()` hook switches to `EventSource`. No UI change required.

---

## Database

**Supabase (hosted Postgres) + Drizzle ORM.** Connection string from Supabase dashboard via `DATABASE_URL` env var. Works locally (direct connection) and on Vercel (pooled connection via `DATABASE_URL_POOLING`).

### Tables

| Table | Purpose | Priority |
|---|---|---|
| `traders` | User registry: id, name, passcode hash, Alpaca account key. Replaces env-var-based trader list. | Core |
| `equity_snapshots` | Daily portfolio value per trader. Powers historical P/L charts independent of Alpaca's `last_equity`. | High |
| `notes` | Trader-attached note on a position or order ("Why I bought this"). Reinforces journaling habit. | High |
| `lesson_progress` | Which lessons each trader has opened / completed. Powers "X/30 lessons" badge. | Medium |
| `settings` | Per-trader preferences. See settings spec below. | Medium |
| `concept_views` | Which inline ConceptTips have been seen (for "unseen" dot indicator). | Low |

### Settings spec
Defined columns, not a JSON blob:

| Setting | Type | Default | Description |
|---|---|---|---|
| `default_chart_timeframe` | enum | `1D` | Default chart period on position detail |
| `default_order_type` | enum | `market` | Pre-selected order type on trade form |
| `one_click_trading` | boolean | false | Skip confirmation dialog on orders |
| `timezone` | string | `America/New_York` | Display timezone for market hours |
| `theme` | enum | `dark` | UI theme (dark / light) |

More settings can be added as columns; schema migration required.

### Migrations
Drizzle Kit: `drizzle-kit generate` → SQL files in `migrations/`. Run `drizzle-kit migrate` to apply.

---

## File organization

```
trading-app/
├── app/
│   ├── (auth)/login/page.tsx              passcode entry
│   ├── (app)/                             everything past login
│   │   ├── layout.tsx                     nav + footer
│   │   ├── page.tsx                       dashboard
│   │   ├── trade/page.tsx
│   │   ├── trade/[symbol]/page.tsx
│   │   ├── positions/[symbol]/page.tsx
│   │   ├── orders/page.tsx
│   │   ├── leaderboard/page.tsx
│   │   └── learn/page.tsx, learn/[topic]/page.tsx
│   ├── api/
│   │   └── stream/route.ts                live updates (phase B)
│   ├── layout.tsx
│   ├── globals.css
│   └── manifest.ts                        PWA manifest
├── middleware.ts                           auth gate (project root — required by Next.js)
├── src/
│   ├── lib/
│   │   ├── alpaca.ts                      typed client + factory
│   │   ├── traders.ts                     DB-backed trader lookup
│   │   ├── auth.ts                        signed-cookie helpers
│   │   ├── teaching.ts                    concept registry
│   │   └── format.ts                      money/pct formatters
│   ├── db/
│   │   ├── client.ts                      Drizzle + Supabase init
│   │   └── schema.ts                      all table definitions
│   ├── server/
│   │   ├── actions/                       Server Actions
│   │   ├── live/                          SSE + Alpaca WS bridge (phase B)
│   │   └── snapshots.ts                   daily equity write helper
│   └── components/
│       ├── ui/                            Button, Card, Input, Sheet, Modal
│       ├── trading/                       PositionRow, OrderForm, PortfolioCard, PnLBadge
│       ├── teaching/                      ConceptTip, GlossaryItem, LessonNav
│       └── charts/                        LightweightChart wrapper (TradingView widget wrapper, phase 2)
├── content/lessons/
│   ├── what-is-a-stock.mdx
│   ├── limit-vs-market.mdx
│   ├── fractional-shares.mdx
│   └── ...                               ~20-30 lessons over time
├── migrations/                            Drizzle SQL migrations
├── scripts/
│   ├── test-broker-api.mjs               (parked)
│   ├── test-trading-api.mjs              smoke test
│   ├── probe-trading-features.mjs        feature audit
│   └── snapshot-equity.mjs               nightly equity snapshot
├── public/                               static assets, app icons
├── ARCHITECTURE.md                       this file
├── ARCREVIEW1.md                         first design review (annotated original)
├── TESTING.md                            how to run and test locally
└── package.json, tsconfig.json, next.config.mjs, postcss.config.mjs
```

---

## Teaching layer

### Concept complexity tiers

Not all concepts are equal. Delivery format should match complexity:

| Tier | Example concepts | Format |
|---|---|---|
| 1 — Quick gloss | Limit order, market order, bid/ask | `<ConceptTip>` inline popover/sheet (1–2 sentences + example) |
| 2 — Short lesson | P&L, fractional shares, order types overview | MDX lesson page (300–500 words, 1 interactive example) |
| 3 — Deep lesson | Shorting, options, forward P/E | MDX lesson (longer, chart scenarios, mini-quiz) |

### Concept registry — `src/lib/teaching.ts`

Hand-curated, easy to extend. Add a new entry, it's immediately available to any `<ConceptTip>` in the UI.

```ts
export const CONCEPTS = {
  "limit-order": {
    tier: 1,
    label: "Limit Order",
    short: "A buy/sell that only fills at your price or better.",
    example: "You set a limit buy on AAPL at $200 while it trades at $205. It waits. If AAPL drops to $200 it fills; otherwise nothing happens.",
    learnMore: "limit-vs-market",
  },
  // ...
} as const;
```

### Inline tip — `<ConceptTip id="limit-order">Limit price</ConceptTip>`

Renders with a small `?` badge. On interaction:
- **Desktop:** popover positioned next to the label
- **Mobile:** bottom sheet sliding up from the bottom

Both show `short` + `example`. Tier 2+ concepts get a "Read the lesson →" button.

### Full lessons — `content/lessons/*.mdx`

MDX lets us embed interactive React components: chart annotations, mini-quizzes, "try it" buttons that pre-fill the trade form. Authored as code, version-controlled, easy to update.

Design direction: short-form, visual-first. More like a TikTok card or interactive explainer than a textbook. Consider embedding YouTube clips for concepts that benefit from video.

---

## UI design direction

Reference apps: **TradingView** (information density without clutter), **Uber** (clean white surfaces, purposeful color), **TikTok** (snappy, visual-first content).

Principles:
- Black / dark backgrounds for the trading interface (numbers read better on dark)
- White / light surfaces for the learn / lesson content
- High contrast, no gradients, no decorative shadows
- Rounded corners only where they serve a purpose (cards, buttons) — not default-corner-rounding everything
- Color is reserved for signal: green = gain, red = loss, blue = action
- Typography does the heavy lifting — no icon forests

---

## Shipping plan

### Web (MVP)
Deploy to **Vercel** (free tier, auto-deploy from GitHub). Accessible at a permanent URL on any device — laptop, iPhone, Android.

### iPhone app (Phase 2 — PWA)
1. Add `app/manifest.ts` (Next.js manifest route) with name, icons, `display: standalone`.
2. Add a service worker for offline shell.
3. Users open the URL in Safari → Share → "Add to Home Screen" → installs. Full-screen, no Safari chrome.
4. This works now with no Apple Developer account.

### iPhone app (Phase 3 — native)
1. Sign up for Apple Developer Program ($99/yr).
2. Install Capacitor, wrap the deployed Next.js backend.
3. Distribute via TestFlight → users install from an invite link.
4. Requires a Mac (or GitHub Actions macOS runner) to build the `.ipa`.

### Android
Sideload the `.apk` (no Play Store required for personal use). Built alongside the iOS Capacitor wrap.

---

## Leaderboard design

The leaderboard shows all traders ranked by portfolio value. Two time windows:
- **Live:** current equity from Alpaca (real-time during market hours via polling or SSE)
- **Historical:** daily snapshots from `equity_snapshots` table — powers "this week" and "all time" views

The nightly equity snapshot job (`scripts/snapshot-equity.mjs`) writes a row per trader at market close. This is what feeds the historical leaderboard, not a separate cutoff. The live leaderboard reads directly from Alpaca.

---

## Open items

- WebSocket live updates — phased. Polling ships first.
- TradingView chart widget integration — post-MVP.
- News feed (Yahoo Finance / Alpaca news) — post-MVP.
- TestFlight + Capacitor — deferred until web is complete.
- Real-money mode via Broker API — parked. See `memory/project_alpaca_strategy.md`.

---

## Phased implementation order

### MVP (phases 1–4)

1. ✅ **Auth** — login page, signed cookie, middleware, DB-backed trader lookup
2. **DB scaffolding** — Supabase + Drizzle setup, all table schemas, migrations, seed traders
3. **Trade placement** — `/trade` with market/limit/stop/bracket order form + Server Action
4. **Position detail + close** — `/positions/[symbol]` with close position button

### V1 (phases 5–8)

5. **ConceptTip** — registry (~30 concepts, tiered) + component (popover desktop / sheet mobile)
6. **Live updates phase A** — `useLiveAccount()` polling hook
7. **Equity snapshot job** — nightly write to `equity_snapshots`; backfill script for history
8. **Leaderboard** — live + historical (daily / weekly / all-time), scales with any number of traders

### V2 (phases 9–12)

9. **MDX lessons** — 5 core: what is a stock, market vs limit, P&L, fractional shares, options basics
10. **Live updates phase B** — SSE + Alpaca WS bridge at `/api/stream`
11. **PWA** — manifest + service worker + app icons
12. **Capacitor wrap** — only after web is feature-complete
