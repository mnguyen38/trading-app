export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-2xl animate-pulse px-5 py-8">
      {/* Header */}
      <div className="mb-6 flex items-baseline justify-between">
        <div className="h-8 w-48 rounded-md bg-neutral-800" />
        <div className="h-4 w-20 rounded bg-neutral-800" />
      </div>

      {/* Portfolio card */}
      <div className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <div className="h-3 w-28 rounded bg-neutral-800" />
        <div className="mt-2 h-10 w-44 rounded-md bg-neutral-800" />
        <div className="mt-2 h-4 w-36 rounded bg-neutral-800" />
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="h-10 rounded-md bg-neutral-800" />
          <div className="h-10 rounded-md bg-neutral-800" />
        </div>
      </div>

      {/* Positions header */}
      <div className="mb-2 h-4 w-24 rounded bg-neutral-800" />

      {/* Position rows */}
      <div className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center justify-between p-4">
            <div className="space-y-1.5">
              <div className="h-4 w-16 rounded bg-neutral-800" />
              <div className="h-3 w-40 rounded bg-neutral-800" />
            </div>
            <div className="space-y-1.5 text-right">
              <div className="h-4 w-20 rounded bg-neutral-800" />
              <div className="h-3 w-16 rounded bg-neutral-800" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
