import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/db/client";
import { pushSubscriptions, orderNotifications } from "@/src/db/schema";
import { getAllTraders } from "@/src/lib/traders";
import { alpacaForTrader } from "@/src/lib/alpaca";
import { webpush } from "@/src/lib/webpush";
import { eq } from "drizzle-orm";
import type { PushSubscriptionJSON } from "@/src/lib/webpush";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allTraders = await getAllTraders();
  let sent = 0;

  for (const trader of allTraders) {
    try {
      const alpaca = alpacaForTrader(trader);
      const orders = await alpaca.getOrders("closed", 20);

      const filled = orders.filter(
        (o: { status: string }) => o.status === "filled",
      );

      const subs = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.traderId, trader.id));

      if (subs.length === 0) continue;

      for (const order of filled) {
        // Skip if we already notified for this order
        const already = await db
          .select({ orderId: orderNotifications.orderId })
          .from(orderNotifications)
          .where(eq(orderNotifications.orderId, order.id))
          .limit(1);
        if (already.length > 0) continue;

        const side = order.side === "buy" ? "Bought" : "Sold";
        const qty = parseFloat(order.filled_qty ?? order.qty ?? "0");
        const price = order.filled_avg_price
          ? `@ $${parseFloat(order.filled_avg_price).toFixed(2)}`
          : "";
        const payload = JSON.stringify({
          title: "Order Filled",
          body: `${side} ${qty} ${order.symbol} ${price}`.trim(),
          url: "/orders",
        });

        for (const row of subs) {
          try {
            await webpush.sendNotification(row.subscription as PushSubscriptionJSON, payload);
          } catch {
            // Stale subscription — remove it
            await db
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.id, row.id));
          }
        }

        await db.insert(orderNotifications).values({
          orderId: order.id,
          traderId: trader.id,
        });
        sent++;
      }
    } catch {
      // continue to next trader
    }
  }

  return NextResponse.json({ sent });
}
