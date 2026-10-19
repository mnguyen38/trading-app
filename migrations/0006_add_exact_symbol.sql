-- Adds the exact traded symbol to strategy_trades, alongside the existing underlying-only
-- `symbol` column. Fixes a real attribution bug: exit logic (groupOptionPositions in
-- src/lib/engine/signals.ts) used to look up a position's owning strategy by underlying
-- alone, which is ambiguous once more than one strategy has ever traded the same
-- underlying — it could merge unrelated trades into one exit-decision group, or let a
-- stale earnings_date from an old trade force a churn loop on an unrelated position.
-- Nullable: existing rows have no way to recover their exact symbol retroactively: the
-- code recording this has only ever stored the underlying.
ALTER TABLE "strategy_trades" ADD COLUMN IF NOT EXISTS "exact_symbol" text;
