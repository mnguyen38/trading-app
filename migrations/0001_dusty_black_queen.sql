CREATE TABLE "order_notifications" (
	"order_id" text PRIMARY KEY NOT NULL,
	"trader_id" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"trader_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"subscription" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_notifications" ADD CONSTRAINT "order_notifications_trader_id_traders_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."traders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_trader_id_traders_id_fk" FOREIGN KEY ("trader_id") REFERENCES "public"."traders"("id") ON DELETE no action ON UPDATE no action;