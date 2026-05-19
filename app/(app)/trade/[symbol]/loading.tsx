export default function TradeLoading() {
  return (
    <main className="mx-auto max-w-sm px-5 py-8 animate-pulse">
      {/* Symbol header */}
      <div className="mb-8">
        <div className="flex items-baseline gap-3">
          <div className="h-8 w-24 rounded-md bg-neutral-800" />
          <div className="h-7 w-28 rounded-md bg-neutral-800" />
        </div>
        <div className="mt-2 h-4 w-36 rounded bg-neutral-800" />
      </div>

      {/* Chart skeleton */}
      <div className="mb-6 h-[500px] w-full rounded-xl bg-neutral-800" />

      {/* BUY / SELL */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="h-11 rounded-lg bg-neutral-800" />
        <div className="h-11 rounded-lg bg-neutral-800" />
      </div>

      {/* Order type */}
      <div className="mb-4 h-10 rounded-lg bg-neutral-800" />

      {/* Qty */}
      <div className="mb-4 h-12 rounded-lg bg-neutral-800" />

      {/* Submit */}
      <div className="mt-2 h-12 rounded-lg bg-neutral-800" />
    </main>
  );
}
