import Link from "next/link";
import { getSession } from "@/src/lib/auth";
import { getAllLessonMeta } from "@/src/lib/lessons";
import { db } from "@/src/db/client";
import { lessonProgress } from "@/src/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const TIER_LABEL = ["", "Basics", "Intermediate", "Advanced"];
const TIER_COLOR = ["", "text-green-400", "text-orange-400", "text-red-400"];

export default async function LearnPage() {
  const traderId = await getSession();
  const [lessons, progress] = await Promise.all([
    Promise.resolve(getAllLessonMeta()),
    db.select().from(lessonProgress).where(eq(lessonProgress.traderId, traderId)),
  ]);

  const completedSlugs = new Set(
    progress.filter(p => p.completedAt).map(p => p.lessonSlug),
  );
  const openedSlugs = new Set(progress.map(p => p.lessonSlug));

  const completedCount = completedSlugs.size;

  // First incomplete lesson is the only one currently unlocked
  const currentIdx = lessons.findIndex(l => !completedSlugs.has(l.slug));
  const allDone = currentIdx === -1;

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Learn</h1>
        <span className="text-sm text-neutral-500">
          {completedCount} / {lessons.length} complete
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-8 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full rounded-full bg-orange-400 transition-all"
          style={{ width: `${lessons.length > 0 ? (completedCount / lessons.length) * 100 : 0}%` }}
        />
      </div>

      <div className="flex flex-col gap-2">
        {lessons.map((lesson, idx) => {
          const done = completedSlugs.has(lesson.slug);
          const opened = openedSlugs.has(lesson.slug);
          const locked = !allDone && idx > currentIdx;
          const isCurrent = idx === currentIdx;

          const rowContent = (
            <>
              {/* Step indicator */}
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  done
                    ? "bg-green-500 text-white"
                    : locked
                    ? "border border-neutral-800 text-neutral-700"
                    : opened
                    ? "border border-orange-400 text-orange-400"
                    : "border border-neutral-600 text-neutral-400"
                }`}
              >
                {done ? "✓" : lesson.order}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${locked ? "text-neutral-600" : "text-neutral-100"}`}>
                    {lesson.title}
                  </span>
                  {isCurrent && !done && (
                    <span className="rounded-full bg-orange-400/15 px-2 py-0.5 text-xs font-medium text-orange-400">
                      Up next
                    </span>
                  )}
                </div>
                <div className={`mt-0.5 truncate text-xs ${locked ? "text-neutral-700" : "text-neutral-500"}`}>
                  {lesson.description}
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className={`text-xs ${TIER_COLOR[lesson.tier]} ${locked ? "opacity-40" : ""}`}>
                  {TIER_LABEL[lesson.tier]}
                </span>
                <span className={`text-xs ${locked ? "text-neutral-700" : "text-neutral-600"}`}>
                  {lesson.estimatedMinutes} min
                </span>
              </div>
            </>
          );

          const rowClass =
            "flex items-center gap-4 rounded-xl border px-4 py-4 transition " +
            (locked
              ? "border-neutral-800/50 bg-neutral-900/40 cursor-not-allowed"
              : done
              ? "border-neutral-800 bg-neutral-900 hover:bg-neutral-800/60"
              : "border-orange-400/20 bg-neutral-900 hover:bg-neutral-800/60");

          return locked ? (
            <div key={lesson.slug} className={rowClass} aria-disabled="true">
              {rowContent}
            </div>
          ) : (
            <Link key={lesson.slug} href={`/learn/${lesson.slug}`} className={rowClass}>
              {rowContent}
            </Link>
          );
        })}
      </div>
    </main>
  );
}
