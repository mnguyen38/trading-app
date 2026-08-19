import { pgTable, text, boolean, real, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";

export const chartTimeframeEnum = pgEnum("chart_timeframe", ["1D", "1W", "1M", "3M", "1Y"]);
export const orderTypeEnum = pgEnum("order_type", ["market", "limit", "stop", "stop_limit"]);
export const themeEnum = pgEnum("theme", ["dark", "light"]);
export const traderTypeEnum = pgEnum("trader_type", ["micro", "macro"]);

export const traders = pgTable("traders", {
  id:           text("id").primaryKey(),
  name:         text("name").notNull(),
  passcodeHash: text("passcode_hash").notNull(),
  accountKey:   text("account_key").notNull(),
  type:         traderTypeEnum("type").default("micro").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});

export const equitySnapshots = pgTable("equity_snapshots", {
  id:        text("id").primaryKey(),
  traderId:  text("trader_id").notNull().references(() => traders.id),
  equity:    real("equity").notNull(),
  cash:      real("cash").notNull(),
  takenAt:   timestamp("taken_at").defaultNow().notNull(),
});

export const notes = pgTable("notes", {
  id:        text("id").primaryKey(),
  traderId:  text("trader_id").notNull().references(() => traders.id),
  symbol:    text("symbol"),
  orderId:   text("order_id"),
  body:      text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const lessonProgress = pgTable("lesson_progress", {
  id:          text("id").primaryKey(),
  traderId:    text("trader_id").notNull().references(() => traders.id),
  lessonSlug:  text("lesson_slug").notNull(),
  openedAt:    timestamp("opened_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const settings = pgTable("settings", {
  traderId:             text("trader_id").primaryKey().references(() => traders.id),
  defaultChartTf:       chartTimeframeEnum("default_chart_tf").default("1D").notNull(),
  defaultOrderType:     orderTypeEnum("default_order_type").default("market").notNull(),
  oneClickTrading:      boolean("one_click_trading").default(false).notNull(),
  timezone:             text("timezone").default("America/New_York").notNull(),
  theme:                themeEnum("theme").default("dark").notNull(),
});

export const conceptViews = pgTable("concept_views", {
  id:         text("id").primaryKey(),
  traderId:   text("trader_id").notNull().references(() => traders.id),
  conceptId:  text("concept_id").notNull(),
  viewedAt:   timestamp("viewed_at").defaultNow().notNull(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id:           text("id").primaryKey(),
  traderId:     text("trader_id").notNull().references(() => traders.id),
  endpoint:     text("endpoint").notNull(),
  subscription: jsonb("subscription").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});

export const orderNotifications = pgTable("order_notifications", {
  orderId:  text("order_id").primaryKey(),
  traderId: text("trader_id").notNull().references(() => traders.id),
  sentAt:   timestamp("sent_at").defaultNow().notNull(),
});

export const strategyTrades = pgTable("strategy_trades", {
  id:           text("id").primaryKey(),
  traderId:     text("trader_id").notNull().references(() => traders.id),
  strategySlug: text("strategy_slug").notNull(),
  orderId:      text("order_id").notNull(),
  symbol:       text("symbol").notNull(),
  side:         text("side").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});

// KV store for per-trader per-strategy persistent state (e.g., inversion day counters,
// last rotation month). One row per (traderId, strategySlug, key).
export const engineState = pgTable("engine_state", {
  id:           text("id").primaryKey(),
  traderId:     text("trader_id").notNull().references(() => traders.id),
  strategySlug: text("strategy_slug").notNull(),
  key:          text("key").notNull(),
  value:        text("value").notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
});

// Scanner cache — refreshed pre-market, consumed by engine signal functions.
export const scannerCache = pgTable("scanner_cache", {
  id:          text("id").primaryKey(),
  traderType:  traderTypeEnum("trader_type").notNull(),
  tickers:     jsonb("tickers").notNull(), // ScanEntry[]
  scannedAt:   timestamp("scanned_at").defaultNow().notNull(),
});

// Audit log for every automated engine run.
export const engineRuns = pgTable("engine_runs", {
  id:       text("id").primaryKey(),
  traderId: text("trader_id").notNull().references(() => traders.id),
  phase:    text("phase").notNull(),   // "entry" | "exit"
  runAt:    timestamp("run_at").defaultNow().notNull(),
  signals:  jsonb("signals"),          // what signals fired
  trades:   jsonb("trades"),           // orders placed
  skipped:  jsonb("skipped"),          // strategies at max positions or no signal
  errors:   jsonb("errors"),           // per-strategy errors
});
