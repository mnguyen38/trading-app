"use client";
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-5xl">📡</div>
      <h1 className="text-2xl font-bold">You&rsquo;re offline</h1>
      <p className="max-w-xs text-sm text-neutral-400">
        Check your connection and try again. Your portfolio data will reload automatically when
        you&rsquo;re back online.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-400"
      >
        Retry
      </button>
    </div>
  );
}
