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
    <nav className="flex h-full items-stretch gap-1">
      {LINKS.map(l => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            prefetch
            className={`flex items-center border-b-2 px-4 text-sm font-medium transition ${
              active
                ? "border-neutral-100 text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-200"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
