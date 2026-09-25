export default function ArenaLoading() {
  return (
    <div className="animate-pulse">
      <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-neutral-800">
        {[0, 1].map(i => (
          <div key={i} className="px-8 py-9">
            <div className="h-4 w-40 rounded bg-neutral-800" />
            <div className="mt-3 h-14 w-72 rounded bg-neutral-800" />
            <div className="mt-6 grid grid-cols-3 gap-6">
              <div className="h-10 rounded bg-neutral-800" />
              <div className="h-10 rounded bg-neutral-800" />
              <div className="h-10 rounded bg-neutral-800" />
            </div>
          </div>
        ))}
      </div>
      <div className="mx-8 my-6 h-72 rounded bg-neutral-900" />
    </div>
  );
}
