import { goToSymbol } from "@/src/server/actions/trade";

export default function TradePage() {
  return (
    <main className="mx-auto max-w-sm px-5 py-12">
      <h1 className="mb-2 text-2xl font-bold">New Order</h1>
      <p className="mb-8 text-sm text-neutral-400">Enter a ticker to get started.</p>

      <form action={goToSymbol} className="flex gap-2">
        <input
          name="symbol"
          type="text"
          placeholder="AAPL"
          autoFocus
          autoCapitalize="characters"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 font-mono uppercase tracking-wider caret-transparent placeholder:normal-case placeholder:tracking-normal placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-neutral-200 active:scale-[0.98]"
        >
          Go →
        </button>
      </form>
    </main>
  );
}
