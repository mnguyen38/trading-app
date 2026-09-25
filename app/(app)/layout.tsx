import Link from "next/link";
import { MarketStatus } from "@/src/components/nav/MarketStatus";
import { NavLinks } from "@/src/components/nav/NavLinks";
import { AutoRefresh } from "@/src/components/arena/AutoRefresh";
import { SIDE_COLOR } from "@/src/lib/arena";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex h-14 items-stretch justify-between border-b border-neutral-800 bg-neutral-950/95 px-6 backdrop-blur">
        <div className="flex items-stretch gap-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex gap-0.5">
              <span className="h-4 w-1.5 rounded-sm" style={{ backgroundColor: SIDE_COLOR.micro }} />
              <span className="h-4 w-1.5 rounded-sm" style={{ backgroundColor: SIDE_COLOR.macro }} />
            </span>
            <span className="text-sm font-bold uppercase tracking-[0.2em]">Trading Lab</span>
          </Link>
          <NavLinks />
        </div>

        <div className="flex items-center gap-5">
          <AutoRefresh />
          <span className="flex items-center gap-1.5 text-xs text-neutral-500">
            NYSE <MarketStatus />
          </span>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
