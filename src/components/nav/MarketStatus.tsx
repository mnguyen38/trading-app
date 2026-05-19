"use client";
import { useState, useEffect } from "react";

import { isNYSEOpen } from "@/src/lib/marketHours";

export function MarketStatus() {
  const [open, setOpen] = useState(isNYSEOpen);

  useEffect(() => {
    const id = setInterval(() => setOpen(isNYSEOpen()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className={`text-xs font-semibold tracking-wide ${open ? "text-green-400" : "text-orange-400"}`}>
      {open ? "OPEN" : "CLOSED"}
    </span>
  );
}
