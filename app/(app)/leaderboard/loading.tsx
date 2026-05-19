export default function LeaderboardLoading() {
  return (
    <main className="mx-auto max-w-2xl animate-pulse px-5 py-8">
      <div className="mb-6 h-8 w-40 rounded-md bg-neutral-800" />

      {/* Standing cards */}
      <div className="mb-8 flex flex-col gap-3">
        {[1, 2].map(i => (
          <div key={i} className="flex items-center gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="h-8 w-8 rounded-full bg-neutral-800" />
            <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-neutral-800" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 rounded bg-neutral-800" />
              <div className="h-7 w-36 rounded-md bg-neutral-800" />
            </div>
            <div className="space-y-2 text-right">
              <div className="h-3 w-16 rounded bg-neutral-800" />
              <div className="h-3 w-14 rounded bg-neutral-800" />
            </div>
          </div>
        ))}
      </div>

      {/* Chart area */}
      <div className="h-4 w-36 rounded bg-neutral-800 mb-3" />
      <div className="h-48 w-full rounded-xl bg-neutral-900 border border-neutral-800" />
    </main>
  );
}
