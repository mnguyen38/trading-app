CREATE TYPE "public"."chart_timeframe" AS ENUM('1D', '1W', '1M', '3M', '1Y');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('market', 'limit', 'stop', 'stop_limit');--> statement-breakpoint
CREATE TYPE "public"."theme" AS ENUM('dark', 'light');--> statement-breakpoint
CREATE TABLE "concept_views" (
	"id" text PRIMARY KEY NOT NULL,
	"trader_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"viewed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equity_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"trader_id" text NOT NULL,
	"equity" real NOT NULL,
	"cash" real NOT NULL,
	"taken_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"trader_id" text NOT NULL,
	"lesson_slug" text NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"trader_id" text NOT NULL,
	"symbol" text,
	"order_id" text,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"trader_id" text PRIMARY KEY NOT NULL,
	"default_chart_tf" chart_timeframe DEFAULT '1D' NOT NULL,
	"default_order_type" "order_type" DEFAULT 'market' NOT NULL,
	"one_click_trading" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"theme" "theme" DEFAULT 'dark' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traders" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"passcode_hash" text NOT NULL,
	"account_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "concept_views" ADD CONSTRAINT "concept_views_trader_id_traders_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."traders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equity_snapshots" ADD CONSTRAINT "equity_snapshots_trader_id_traders_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."traders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_trader_id_traders_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."traders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_trader_id_traders_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."traders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_trader_id_traders_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."traders"("id") ON DELETE no action ON UPDATE no action;