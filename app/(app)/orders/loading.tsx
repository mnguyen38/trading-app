export default function OrdersLoading() {
  return (
    <main className="mx-auto max-w-2xl animate-pulse px-5 py-8">
      <div className="mb-6 h-8 w-24 rounded-md bg-neutral-800" />

      <div className="divide-y divide-neutral-800 rounded-xl border border-neutral-800">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex items-start justify-between px-4 py-3.5">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="h-4 w-10 rounded bg-neutral-800" />
                <div className="h-4 w-16 rounded bg-neutral-800" />
                <div className="h-3 w-12 rounded bg-neutral-800" />
              </div>
              <div className="h-3 w-48 rounded bg-neutral-800" />
              <div className="h-3 w-32 rounded bg-neutral-800" />
            </div>
            <div className="h-3 w-16 rounded bg-neutral-800" />
          </div>
        ))}
      </div>
    </main>
  );
}
