CREATE TYPE "public"."trader_type" AS ENUM('micro', 'macro');--> statement-breakpoint
CREATE TABLE "strategy_trades" (
	"id" text PRIMARY KEY NOT NULL,
	"trader_id" text NOT NULL,
	"strategy_slug" text NOT NULL,
	"order_id" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "traders" ADD COLUMN "type" "trader_type" DEFAULT 'micro' NOT NULL;--> statement-breakpoint
ALTER TABLE "strategy_trades" ADD CONSTRAINT "strategy_trades_trader_id_traders_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."traders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Seed: set the macro trader's type. Replace MACRO_ACCOUNT_KEY with the value from .env
-- (the suffix after ALPACA_TRADING_KEY_ID_ for User 2, e.g. 'TRADER2')
UPDATE "traders" SET "type" = 'macro' WHERE "account_key" = 'MACRO_ACCOUNT_KEY';