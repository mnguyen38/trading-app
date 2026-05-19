export default function PositionLoading() {
  return (
    <main className="mx-auto max-w-sm px-5 py-8 animate-pulse">
      <div className="mb-6">
        <div className="flex items-baseline gap-3">
          <div className="h-8 w-20 rounded-md bg-neutral-800" />
          <div className="h-7 w-28 rounded-md bg-neutral-800" />
        </div>
        <div className="mt-2 h-4 w-36 rounded bg-neutral-800" />
      </div>

      <div className="h-[550px] w-full rounded-xl bg-neutral-800" />

      <div className="my-6" />

      <div className="mb-6 rounded-xl bg-neutral-800 h-28" />

      <div className="h-10 rounded-lg bg-neutral-800" />
      <div className="mt-3 h-12 rounded-xl bg-neutral-800" />
    </main>
  );
}
