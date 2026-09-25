// Shown instantly while a route's server data streams in, so nav clicks never feel stalled.

function Bar({ className }: { className: string }) {
  return <div className={`rounded bg-neutral-800 ${className}`} />;
}

export function PageHeaderSkeleton() {
  return (
    <div className="border-b border-neutral-800 px-8 py-6">
      <Bar className="h-6 w-40" />
      <Bar className="mt-3 h-3.5 w-2/3 max-w-xl" />
    </div>
  );
}

export function TwoColumnSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-neutral-800">
      {[0, 1].map(col => (
        <div key={col} className="px-8 py-7">
          <Bar className="mb-6 h-5 w-48" />
          <div className="divide-y divide-neutral-800/70 border-y border-neutral-800/70">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="py-4">
                <div className="mb-2 flex justify-between">
                  <Bar className="h-4 w-40" />
                  <Bar className="h-4 w-16" />
                </div>
                <div className="h-3 w-1/2 rounded bg-neutral-900" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
