"use server";
import { getSession } from "@/src/lib/auth";
import { db } from "@/src/db/client";
import { lessonProgress } from "@/src/db/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function markLessonComplete(formData: FormData) {
  const traderId = await getSession();
  const slug = formData.get("slug") as string;
  if (!slug) return;

  const existing = await db
    .select()
    .from(lessonProgress)
    .where(and(eq(lessonProgress.traderId, traderId), eq(lessonProgress.lessonSlug, slug)));

  if (existing[0]) {
    if (!existing[0].completedAt) {
      await db
        .update(lessonProgress)
        .set({ completedAt: new Date() })
        .where(eq(lessonProgress.id, existing[0].id));
    }
  } else {
    const now = new Date();
    await db.insert(lessonProgress).values({
      id: crypto.randomUUID(),
      traderId,
      lessonSlug: slug,
      openedAt:    now,
      completedAt: now,
    });
  }

  revalidatePath(`/learn/${slug}`);
  revalidatePath("/learn");
}
