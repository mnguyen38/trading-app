"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  {
    href: "/",
    label: "Home",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M3 9.5L11 3l8 6.5V19a1 1 0 01-1 1H6a1 1 0 01-1-1V9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M8 20v-7h6v7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    href: "/trade",
    label: "Trade",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M11 3v16M6 7l5-5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M16 15l-5 5-5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    href: "/orders",
    label: "Orders",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M4 6h14M4 11h14M4 16h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: "/strategies",
    label: "Plays",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="11" cy="11" r="3" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M11 3v2M11 17v2M3 11h2M17 11h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: "/earnings",
    label: "Earnings",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="3" y="4" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M3 9h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M8 2v4M14 2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M7 13h2M10 13h2M13 13h2M7 16h2M10 16h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-10 flex border-t border-neutral-800 bg-neutral-950/95 backdrop-blur-sm md:hidden">
      {tabs.map(tab => {
        const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] transition ${
              active ? "text-orange-400" : "text-neutral-500"
            }`}
          >
            {tab.icon}
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
