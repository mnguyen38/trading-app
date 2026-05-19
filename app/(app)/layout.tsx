import Link from "next/link";
import { MarketStatus } from "@/src/components/nav/MarketStatus";
import { BottomNav } from "@/src/components/nav/BottomNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Top nav — extends behind Dynamic Island, safe-top pushes content below it */}
      <nav className="safe-top sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
          <Link href="/" className="text-base font-bold tracking-tight">
            Trading Lab
          </Link>

          <div className="flex items-center gap-1 text-sm">
            {/* Desktop nav links — hidden on mobile (bottom tab bar takes over) */}
            <div className="hidden items-center gap-1 md:flex">
              <Link href="/trade" className="rounded-md px-3 py-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-orange-400">
                Trade
              </Link>
              <Link href="/orders" className="rounded-md px-3 py-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-orange-400">
                Orders
              </Link>
              <Link href="/leaderboard" className="rounded-md px-3 py-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-orange-400">
                Board
              </Link>
              <Link href="/learn" className="rounded-md px-3 py-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-orange-400">
                Learn
              </Link>
              <span className="mx-2 text-neutral-700">|</span>
            </div>

            <MarketStatus />
            <span className="mx-2 text-neutral-700">|</span>

            <Link
              href="/settings"
              className="rounded-md px-3 py-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-orange-400"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-label="Settings">
                <rect x="1" y="3" width="14" height="1.5" rx="0.75" fill="currentColor"/>
                <rect x="1" y="7.25" width="14" height="1.5" rx="0.75" fill="currentColor"/>
                <rect x="1" y="11.5" width="14" height="1.5" rx="0.75" fill="currentColor"/>
              </svg>
            </Link>
          </div>
        </div>
      </nav>

      {/* Page content — extra bottom padding on mobile so it clears the tab bar */}
      <div className="flex-1 pb-20 md:pb-0">{children}</div>

      {/* Mobile bottom tab bar */}
      <BottomNav />
    </div>
  );
}
