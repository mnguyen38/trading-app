CREATE TABLE "engine_state" (
  "id"            text PRIMARY KEY NOT NULL,
  "trader_id"     text NOT NULL REFERENCES "traders"("id"),
  "strategy_slug" text NOT NULL,
  "key"           text NOT NULL,
  "value"         text NOT NULL,
  "updated_at"    timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "engine_runs" (
  "id"        text PRIMARY KEY NOT NULL,
  "trader_id" text NOT NULL REFERENCES "traders"("id"),
  "phase"     text NOT NULL,
  "run_at"    timestamp DEFAULT now() NOT NULL,
  "signals"   jsonb,
  "trades"    jsonb,
  "skipped"   jsonb,
  "errors"    jsonb
);
