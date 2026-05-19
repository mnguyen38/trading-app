import { pgTable, text, boolean, real, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const chartTimeframeEnum = pgEnum("chart_timeframe", ["1D", "1W", "1M", "3M", "1Y"]);
export const orderTypeEnum = pgEnum("order_type", ["market", "limit", "stop", "stop_limit"]);
export const themeEnum = pgEnum("theme", ["dark", "light"]);

export const traders = pgTable("traders", {
  id:           text("id").primaryKey(),
  name:         text("name").notNull(),
  passcodeHash: text("passcode_hash").notNull(),
  accountKey:   text("account_key").notNull(),
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
