CREATE TABLE "scanner_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"trader_type" "trader_type" NOT NULL,
	"tickers" jsonb NOT NULL,
	"scanned_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "scanner_cache_trader_type_scanned_at_idx"
  ON "scanner_cache" ("trader_type", "scanned_at" DESC);
