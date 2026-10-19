import Link from "next/link";
import { MarketStatus } from "@/src/components/nav/MarketStatus";
import { NavLinks } from "@/src/components/nav/NavLinks";
import { AutoRefresh } from "@/src/components/arena/AutoRefresh";
import { SIDE_COLOR } from "@/src/lib/arena";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex h-18 items-stretch justify-between border-b border-line bg-paper/95 px-6 backdrop-blur lg:px-14">
        <div className="flex items-stretch gap-12">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex gap-0.5">
              <span className="h-5 w-1.5 rounded-sm" style={{ backgroundColor: SIDE_COLOR.micro }} />
              <span className="h-5 w-1.5 rounded-sm" style={{ backgroundColor: SIDE_COLOR.macro }} />
            </span>
            <span className="font-serif text-2xl font-semibold">Trading Lab</span>
          </Link>
          <NavLinks />
        </div>

        <div className="flex items-center gap-6">
          <AutoRefresh />
          <span className="flex items-center gap-1.5 text-sm text-muted">
            NYSE <MarketStatus />
          </span>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
