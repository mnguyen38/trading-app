import { notFound } from "next/navigation";
import Link from "next/link";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import { getSession } from "@/src/lib/auth";
import { getAllLessonMeta, getLessonBySlug } from "@/src/lib/lessons";
import { db } from "@/src/db/client";
import { lessonProgress } from "@/src/db/schema";
import { and, eq } from "drizzle-orm";
import { mdxComponents } from "@/src/components/teaching/MdxComponents";
import { MarkCompleteButton } from "@/src/components/teaching/MarkCompleteButton";
import { isNYSEOpen } from "@/src/lib/marketHours";

export const dynamic = "force-dynamic";

const TIER_LABEL = ["", "Basics", "Intermediate", "Advanced"];

export default async function LessonPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lesson = getLessonBySlug(slug);
  if (!lesson) notFound();

  const traderId = await getSession();
  const marketOpen = isNYSEOpen();

  // Determine whether this lesson is locked (any earlier lesson is incomplete)
  const allLessons = getAllLessonMeta();
  const thisIdx = allLessons.findIndex(l => l.slug === slug);

  const allProgress = await db
    .select()
    .from(lessonProgress)
    .where(eq(lessonProgress.traderId, traderId));

  const completedSlugs = new Set(
    allProgress.filter(p => p.completedAt).map(p => p.lessonSlug),
  );

  const isLocked = allLessons.slice(0, thisIdx).some(l => !completedSlugs.has(l.slug));

  if (isLocked) {
    const prevLesson = allLessons[thisIdx - 1];
    return (
      <main className="mx-auto max-w-2xl px-5 py-8">
        <Link href="/learn" className="mb-6 block text-sm text-neutral-400 hover:text-white">
          ← All lessons
        </Link>
        <div className="mt-12 flex flex-col items-center gap-4 text-center">
          <h1 className="text-xl font-bold">This lesson is locked</h1>
          <p className="max-w-xs text-sm text-neutral-400">
            Complete{" "}
            <Link href={`/learn/${prevLesson.slug}`} className="text-orange-400 underline underline-offset-2">
              {prevLesson.title}
            </Link>{" "}
            first, then this one unlocks automatically.
          </p>
          <Link
            href="/learn"
            className="mt-2 rounded-lg bg-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            Back to lessons
          </Link>
        </div>
      </main>
    );
  }

  const existing = allProgress.filter(p => p.lessonSlug === slug);

  if (!existing[0]) {
    await db.insert(lessonProgress).values({
      id: crypto.randomUUID(),
      traderId,
      lessonSlug: slug,
    });
  }

  const done = !!existing[0]?.completedAt;
  const isPractical = lesson.completionAction !== "read";

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/learn" className="mb-6 block text-sm text-neutral-400 hover:text-white">
        ← All lessons
      </Link>

      <header className="mb-8">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-full bg-neutral-800 px-2.5 py-0.5 text-xs text-neutral-500">
            {TIER_LABEL[lesson.tier]}
          </span>
          <span className="text-xs text-neutral-600">{lesson.estimatedMinutes} min</span>
          {isPractical && (
            <span className="rounded-full bg-orange-400/10 px-2.5 py-0.5 text-xs font-medium text-orange-400">
              Practical
            </span>
          )}
        </div>
        <h1 className="text-3xl font-bold">{lesson.title}</h1>
        <p className="mt-2 text-neutral-400">{lesson.description}</p>
      </header>

      <article>
        <MDXRemote
          source={lesson.content}
          components={mdxComponents}
          options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
        />
      </article>

      {/* Mission box for practical lessons */}
      {isPractical && (
        <div className={`mt-8 rounded-xl border p-5 ${
          done
            ? "border-green-500/30 bg-green-500/5"
            : "border-orange-400/30 bg-orange-400/5"
        }`}>
          {done ? (
            <div className="flex items-center gap-2 text-green-400">
              <span className="text-lg">✓</span>
              <div>
                <div className="font-semibold">Mission complete</div>
                <div className="text-sm text-green-400/70">You executed this lesson in the real market.</div>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-orange-400">
                Your Mission
              </div>
              <p className="mb-4 text-sm leading-relaxed text-neutral-300">{lesson.missionText}</p>

              {lesson.requiresMarketOpen && (
                <p className="mb-4 text-xs text-neutral-500">
                  Market is currently{" "}
                  <span className={marketOpen ? "text-green-400" : "text-orange-400"}>
                    {marketOpen ? "OPEN" : "CLOSED"}
                  </span>
                  {!marketOpen && " — read through and come back when it opens (9:30am–4:00pm ET, Mon–Fri)."}
                  {marketOpen && " — you're good to go."}
                </p>
              )}

              <Link
                href={lesson.actionHref}
                className="inline-flex items-center gap-2 rounded-lg bg-orange-400 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-orange-300 active:scale-95"
              >
                {lesson.actionLabel} →
              </Link>
              <p className="mt-3 text-xs text-neutral-600">
                This lesson marks itself complete automatically when you execute.
              </p>
            </>
          )}
        </div>
      )}

      {/* Read-only lesson footer */}
      {!isPractical && (
        <div className="mt-10 flex items-center justify-between border-t border-neutral-800 pt-6">
          <MarkCompleteButton slug={slug} done={done} />
          <Link href="/learn" className="text-sm text-neutral-500 hover:text-neutral-300">
            Back to lessons
          </Link>
        </div>
      )}
    </main>
  );
}
