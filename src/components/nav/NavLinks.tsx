"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Arena" },
  { href: "/strategies", label: "Strategies" },
  { href: "/performance", label: "Performance" },
  { href: "/earnings", label: "Earnings" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-8">
      {LINKS.map(l => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            prefetch
            aria-current={active ? "page" : undefined}
            className={`border-b-2 pb-1 text-[15px] transition ${
              active
                ? "border-ink font-semibold text-ink"
                : "border-transparent font-medium text-muted hover:text-ink"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
