"use server";
import { db } from "@/src/db/client";
import { pushSubscriptions } from "@/src/db/schema";
import { getSession } from "@/src/lib/auth";
import { eq, and } from "drizzle-orm";
import type { PushSubscriptionJSON } from "@/src/lib/webpush";

export async function saveSubscription(sub: PushSubscriptionJSON) {
  const traderId = await getSession();

  const existing = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.traderId, traderId),
        eq(pushSubscriptions.endpoint, sub.endpoint),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(pushSubscriptions).values({
      id: crypto.randomUUID(),
      traderId,
      endpoint: sub.endpoint,
      subscription: sub,
    });
  }
}

export async function deleteSubscription(endpoint: string) {
  const traderId = await getSession();
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.traderId, traderId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    );
}
