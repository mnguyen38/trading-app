# Architecture — Review 1
*Original architecture document with annotations from the first design review.*

> **How to read this:** Main text is the original architecture. Callout blocks marked **[Review]** are notes left during review. The clean revised version lives in `ARCHITECTURE.md`.

---

The shape of the trading app: how data flows, what each piece is for, and the constraints that shaped the decisions.

> **[Review]:** Goal: educational paper-trading app for 2 specific kids (brother + friend), but designed and created in a way for possible expansion to > 2 users. Accessible on iPhone and laptop, with inline teaching. End state is a downloadable app — phased rollout: Next.js web → PWA → Capacitor wrap.

## Layered overview

```
┌─────────────────────────────────────────────────────────┐
│  Browser (Safari iPhone, Chrome laptop, installed PWA)  │
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
│ Alpaca       │  │ Alpaca       │  │ Alpaca WS │  │ SQLite     │
│ Trading API  │  │ Data API     │  │ (live)    │  │ (Drizzle)  │
└──────────────┘  └──────────────┘  └───────────┘  └────────────┘
```

> **[Review]:** Prefer to use Supabase for the database instead of SQLite, for familiarity. Open to other platforms. Perhaps AWS for both deployment and database?

## Distribution roadmap

1. **Now:** Next.js web app, mobile-responsive.
2. **Soon:** Add PWA manifest + service worker. Kids "install" via Safari "Add to Home Screen" — feels like an app.
3. **Eventually:** Wrap with Capacitor → real `.ipa` / `.apk`. Distribute via TestFlight (iOS) and sideload (Android). Requires architectural split: Alpaca keys can't ship in a downloadable bundle.

## Routes

```
/login                  passcode entry        no auth
/                       dashboard             auth required
/trade                  new order, generic
/trade/[symbol]         new order, pre-filled
/positions/[symbol]     position detail
/orders                 order history
/leaderboard            both traders side-by-side
/learn                  glossary + lesson index
/learn/[topic]          full lesson (MDX)
/api/logout             POST clears cookie
/api/stream             SSE — live account + market events (phase 2)
```

> **[Review]:** Leaderboard can be expanded in the future when there are more than 2 accounts.

> **[Review]:** Learn page design should take from short-form content / modern interactive apps — more graphical interface than walls of text. Actual content can come from various sources (YouTube?).

> **[Review]:** Would also like to add a live chart API (TradingView is what I use personally) and relevant news (Yahoo Finance, etc.). Can be expanded on later.

## Auth

`.env` holds passcodes (4-6 digits per trader) and a session signing secret.

Flow:
1. `/login` → form submits passcode → Server Action `login()` matches against env → if match, set signed cookie `session={traderId}` → redirect `/`.
2. `middleware.ts` runs on protected routes → reads cookie → if missing or invalid → redirect to `/login`.
3. Server components / actions read the cookie via `getSession()` to know who they're serving.

> **[Review]:** "No login UI for switching trader — just a Switch button" is wrong. Want a proper login UI for when the project expands beyond 2 users — then there can be more than just 2 traders without code changes.

## Data flow

### Reads — React Server Components

Page is `async function Page()`. Pulls trader from cookie, instantiates `alpacaForTrader(...)`, awaits the data, renders HTML server-side. No client fetch code.

### Mutations — Server Actions

Form submits straight to a Server Action. No client fetch code, works without JS. On success, `revalidatePath('/')` rebuilds the page with fresh data.

### Live updates — SSE + WS bridge (phased)

**Phase A — polling (ship first):** Client component calls a `useLiveAccount()` hook that polls every 5s while the page is visible, pauses when the tab is backgrounded.

> **[Review]:** Also calls on page refresh.

**Phase B — true live:** Server opens SSE at `/api/stream`, bridges to Alpaca WebSockets. Browser hook switches to `EventSource`. No UI change.

## Database

**SQLite via `better-sqlite3` + Drizzle ORM.** Local file `data/trading.db`, gitignored.

> **[Review]:** Prefer Supabase. Open to AWS as well.

| Table | Purpose | Review |
|---|---|---|
| `equity_snapshots` | Daily equity per trader. Historical P/L charts. | ✅ I like this |
| `lesson_progress` | Which lessons each trader has opened / completed. | ✅ Good |
| `concept_views` | Tracks which inline ConceptTips have been seen. | ⬇️ Lower priority, less needed |
| `settings` | Per-trader preferences. | ⚠️ Too vague — needs detail: accessibility settings, one-click trading, time zones, etc. |
| `notes` | Trader can attach a note to a position / order. | ✅ Good |

> **[Review]:** Could the nightly equity snapshot job serve as the leaderboard cutoff update? Or would the leaderboard be live?

## Teaching layer

> **[Review]:** Will need to plan and distinguish between shorter-form concepts that are intuitive (e.g. limit order) vs. complex concepts (e.g. forward P/E, shorting). The complexity of the concept should dictate the delivery format.

### Concept registry — `src/lib/teaching.ts`

30-ish entries, hand-curated.

> **[Review]:** Should be easy to add to, in case updates are needed.

### Inline tip — `<ConceptTip id="limit-order">Limit price</ConceptTip>`

- Desktop: popover
- Mobile: bottom sheet

### Full lessons — `content/lessons/*.mdx`

MDX with embedded interactive React components (chart annotations, mini-quizzes, "try it" buttons).

## Constraints

| Constraint | Where it shows up |
|---|---|
| Only 2 users | No multi-tenancy, no analytics, no SSO. SQLite, not Postgres. |
| iPhone + laptop | Server-rendered, mobile-first Tailwind. Bottom-sheet on touch. PWA-first. |
| Educational | Teaching in the same room as the controls. Concept tips, lessons, notes. |
| Eventually downloadable | Secrets server-side from day one. Clean boundaries for Capacitor split later. |
| Paper money only (for now) | No KYC, no real-money error paths. |

## Phased implementation order

1. ✅ **Auth refactor** — `/login` page, cookie session, middleware.
2. **DB scaffolding** — Drizzle setup, schema, migrations.
3. **Trade placement page** — `/trade` with full order form, Server Action.
4. **Concept tips MVP** — registry + `<ConceptTip>` component.
   > **[Review]:** Not MVP. Can be moved down to after Position detail.
5. **Position detail + close button** — `/positions/[symbol]`.
   > **[Review]:** This is the MVP cutoff.
---
6. **Live updates phase A** — polling hook.
7. **Leaderboard page** — both traders side-by-side, today / week / all-time.
8. **First MDX lessons** — 5 core lessons.
---
9. **Live updates phase B** — SSE + WS bridge.
10. **Daily equity snapshot job** — backfill historical chart.
    > **[Review]:** Should be implemented before leaderboard, not after.
11. **PWA manifest + icons + service worker.**
12. **Capacitor wrap.**

> **[Review]:** Should add exactly how the app will be shipped. Needs to be compatible with iPhone in App form and on Windows/Mac as a website.

> **[Review]:** Missing a testing plan. Needs a Testing.md doc covering how to test on iPhone and Web, API testing, etc.

> **[Review]:** Another priority is a clean, modern UI. Reference: TikTok design, Uber design, TradingView. Clean, little clutter, not default-app clumsy. Black on white color scheme is suitable.
