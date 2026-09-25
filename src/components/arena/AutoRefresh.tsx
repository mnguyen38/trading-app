"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Re-runs the server components on an interval so equity/positions stay current
// without a websocket. Pauses while the tab is hidden.
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  const [lastAt, setLastAt] = useState<Date | null>(null);

  useEffect(() => {
    setLastAt(new Date());
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setLastAt(new Date());
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);

  return (
    <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
      Live{lastAt ? ` · ${lastAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : ""}
    </span>
  );
}
