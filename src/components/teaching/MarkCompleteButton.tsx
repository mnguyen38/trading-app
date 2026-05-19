"use client";
import { useTransition } from "react";
import { markLessonComplete } from "@/src/server/actions/learn";

export function MarkCompleteButton({ slug, done }: { slug: string; done: boolean }) {
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-400">
        <span>✓</span>
        <span>Lesson complete</span>
      </div>
    );
  }

  return (
    <form
      action={formData => startTransition(() => markLessonComplete(formData))}
    >
      <input type="hidden" name="slug" value={slug} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 transition hover:border-green-500 hover:text-green-400 disabled:opacity-50"
      >
        {pending ? "Saving…" : "✓ Mark as complete"}
      </button>
    </form>
  );
}
