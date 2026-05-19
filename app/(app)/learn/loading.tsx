export default function LearnLoading() {
  return (
    <main className="mx-auto max-w-2xl animate-pulse px-5 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <div className="h-8 w-20 rounded-md bg-neutral-800" />
        <div className="h-4 w-28 rounded bg-neutral-800" />
      </div>
      <div className="mb-8 h-1.5 w-full rounded-full bg-neutral-800" />

      <div className="mb-2 h-3 w-16 rounded bg-neutral-800" />
      <div className="mb-8 flex flex-col divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex items-center gap-4 px-4 py-4">
            <div className="h-5 w-5 shrink-0 rounded-full bg-neutral-800" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-40 rounded bg-neutral-800" />
              <div className="h-3 w-64 rounded bg-neutral-800" />
            </div>
            <div className="h-3 w-10 rounded bg-neutral-800" />
          </div>
        ))}
      </div>
    </main>
  );
}
