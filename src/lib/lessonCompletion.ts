import { db } from "@/src/db/client";
import { lessonProgress } from "@/src/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getAllLessonMeta } from "./lessons";
import { isNYSEOpen } from "./marketHours";

export type LessonAction = "buy-order" | "limit-order" | "close-position";

// Which lesson completionActions a given real action satisfies.
// A limit buy also satisfies "buy-order" lessons.
const SATISFIES: Record<LessonAction, string[]> = {
  "buy-order":       ["buy-order"],
  "limit-order":     ["buy-order", "limit-order"],
  "close-position":  ["close-position"],
};

export async function completeLessonsByAction(
  traderId: string,
  action: LessonAction,
): Promise<void> {
  if (!isNYSEOpen()) return; // lessons only complete during market hours

  const satisfied = SATISFIES[action];
  const allLessons = getAllLessonMeta();
  const targetSlugs = new Set(
    allLessons
      .filter(l => l.completionAction && satisfied.includes(l.completionAction))
      .map(l => l.slug),
  );
  if (targetSlugs.size === 0) return;

  const pending = await db
    .select({ id: lessonProgress.id, lessonSlug: lessonProgress.lessonSlug })
    .from(lessonProgress)
    .where(and(eq(lessonProgress.traderId, traderId), isNull(lessonProgress.completedAt)));

  const toComplete = pending.filter(p => targetSlugs.has(p.lessonSlug));
  if (toComplete.length === 0) return;

  const now = new Date();
  await Promise.all(
    toComplete.map(p =>
      db.update(lessonProgress).set({ completedAt: now }).where(eq(lessonProgress.id, p.id)),
    ),
  );
}
