"use client";
import { useEffect, useRef } from "react";

export function TradingViewChart({ symbol }: { symbol: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = "";

    // Read the actual rendered height so the widget config matches the CSS container.
    // On mobile this is ~30dvh; on desktop it's the fixed 460px.
    const containerHeight = ref.current.clientHeight;

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.textContent = JSON.stringify({
      width: "100%",
      height: containerHeight,
      symbol,
      interval: "D",
      timezone: "America/New_York",
      theme: "dark",
      style: "1",
      locale: "en",
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      save_image: false,
      hide_volume: true,
      support_host: "https://www.tradingview.com",
    });

    ref.current.appendChild(widget);
    ref.current.appendChild(script);
  }, [symbol]);

  return (
    <div
      ref={ref}
      // Mobile: 30% of dynamic viewport height — fits all phone screen sizes.
      // Desktop: fixed 460px.
      className="tradingview-widget-container h-[30dvh] w-full overflow-hidden rounded-xl border border-neutral-800 md:h-[460px]"
    />
  );
}
