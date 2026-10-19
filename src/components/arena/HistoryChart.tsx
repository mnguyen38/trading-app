"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartSeries } from "@/src/components/trading/EquityChart";

const DAY = 86_400_000;
const HEIGHT = 360;
const PT = 12, PR = 16, PB = 28, PL = 64;
const MIN_SPAN = 2 * DAY;

const RANGES: { label: string; days: number | null }[] = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "ALL", days: null },
];

type View = [number, number] | null; // null = follow the full range

const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function money(v: number) {
  return Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
}
function fullMoney(v: number) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtDate(ms: number, opts: Intl.DateTimeFormatOptions) {
  return new Date(ms).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}

// Picks a tick spacing (in days) that keeps labels roughly 100px apart.
function tickStepDays(spanMs: number, widthPx: number) {
  const target = Math.max(2, Math.floor(widthPx / 110));
  const steps = [1, 2, 3, 7, 14, 30, 60, 91, 182, 365];
  return steps.find(s => (spanMs / DAY) / s <= target) ?? 365;
}

export function HistoryChart({ series }: { series: ChartSeries[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(1200);
  const [view, setView] = useState<View>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const drag = useRef<{ startX: number; view: [number, number] } | null>(null);

  // Full time domain across every series.
  const [fullMin, fullMax] = useMemo(() => {
    const times = series.flatMap(s => s.points.map(p => toMs(p.date)));
    if (times.length === 0) return [0, DAY];
    const lo = Math.min(...times), hi = Math.max(...times);
    return lo === hi ? [lo - DAY, hi + DAY] : [lo, hi];
  }, [series]);
  const fullSpan = fullMax - fullMin;

  const [v0, v1] = useMemo<[number, number]>(() => {
    if (!view) return [fullMin, fullMax];
    const span = clamp(view[1] - view[0], Math.min(MIN_SPAN, fullSpan), fullSpan);
    const start = clamp(view[0], fullMin, fullMax - span);
    return [start, start + span];
  }, [view, fullMin, fullMax, fullSpan]);
  const span = v1 - v0;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cW = Math.max(width - PL - PR, 50);
  const cH = HEIGHT - PT - PB;
  const xOf = useCallback((t: number) => PL + ((t - v0) / span) * cW, [v0, span, cW]);

  // Wheel zoom around the cursor. Needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = svg!.getBoundingClientRect();
      const frac = clamp((e.clientX - rect.left - PL) / cW, 0, 1);
      const anchor = v0 + frac * span;
      const nextSpan = clamp(span * Math.exp(e.deltaY * 0.0015), Math.min(MIN_SPAN, fullSpan), fullSpan);
      const start = clamp(anchor - frac * nextSpan, fullMin, fullMax - nextSpan);
      setView(nextSpan >= fullSpan ? null : [start, start + nextSpan]);
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [v0, span, cW, fullMin, fullMax, fullSpan]);

  function onPointerDown(e: React.PointerEvent) {
    if (span >= fullSpan) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, view: [v0, v1] };
  }
  function onPointerMove(e: React.PointerEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    setHoverX(e.clientX - rect.left);
    const d = drag.current;
    if (!d) return;
    const dt = -((e.clientX - d.startX) / cW) * (d.view[1] - d.view[0]);
    const start = clamp(d.view[0] + dt, fullMin, fullMax - (d.view[1] - d.view[0]));
    setView([start, start + (d.view[1] - d.view[0])]);
  }
  function endDrag() { drag.current = null; }

  function setRange(days: number | null) {
    setView(days === null || days * DAY >= fullSpan ? null : [fullMax - days * DAY, fullMax]);
  }

  // Y-scale fits whatever is currently visible, so zooming in reveals finer movement.
  const [minY, maxY] = useMemo(() => {
    const vis = series.flatMap(s => s.points.filter(p => {
      const t = toMs(p.date);
      return t >= v0 && t <= v1;
    }).map(p => p.equity));
    const pool = vis.length > 0 ? vis : series.flatMap(s => s.points.map(p => p.equity));
    if (pool.length === 0) return [0, 1];
    const lo = Math.min(...pool), hi = Math.max(...pool);
    const pad = hi !== lo ? (hi - lo) * 0.12 : hi * 0.02 || 1;
    return [lo - pad, hi + pad];
  }, [series, v0, v1]);
  const yOf = (v: number) => PT + (1 - (v - minY) / (maxY - minY)) * cH;

  // Ticks
  const stepMs = tickStepDays(span, cW) * DAY;
  const ticks: number[] = [];
  for (let t = Math.ceil(v0 / stepMs) * stepMs; t <= v1; t += stepMs) ticks.push(t);
  const tickFmt: Intl.DateTimeFormatOptions =
    stepMs >= 60 * DAY ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" };

  // Hover: nearest data date across all series
  const allTimes = useMemo(
    () => [...new Set(series.flatMap(s => s.points.map(p => toMs(p.date))))].sort((a, b) => a - b),
    [series],
  );
  let hoverT: number | null = null;
  if (hoverX !== null && allTimes.length > 0 && hoverX >= PL && hoverX <= width - PR) {
    const t = v0 + ((hoverX - PL) / cW) * span;
    hoverT = allTimes.reduce((best, c) => (Math.abs(c - t) < Math.abs(best - t) ? c : best), allTimes[0]);
    if (hoverT < v0 || hoverT > v1) hoverT = null;
  }
  const hoverRows = hoverT === null ? [] : series.map(s => {
    const p = s.points.find(pt => toMs(pt.date) === hoverT);
    return { name: s.name, color: s.color, equity: p?.equity ?? null };
  });

  const zoomed = span < fullSpan;
  const visibleDays = Math.round(span / DAY);
  const tooltipRight = hoverT !== null && xOf(hoverT) > width * 0.65;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted">
          {fmtDate(v0, { month: "short", day: "numeric", year: "numeric" })} –{" "}
          {fmtDate(v1, { month: "short", day: "numeric", year: "numeric" })} · {visibleDays} day{visibleDays === 1 ? "" : "s"}
        </span>
        <div className="flex gap-1">
          {RANGES.map(r => {
            const active = r.days === null ? !zoomed : zoomed && Math.abs(span - r.days * DAY) < DAY / 2;
            return (
              <button
                key={r.label}
                type="button"
                onClick={() => setRange(r.days)}
                className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition ${
                  active ? "border-ink bg-ink text-paper" : "border-line text-muted hover:text-ink"
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={wrapRef} className="relative select-none">
        <svg
          ref={svgRef}
          width={width}
          height={HEIGHT}
          className={`block ${zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"}`}
          style={{ touchAction: "pan-y" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => { endDrag(); setHoverX(null); }}
          onDoubleClick={() => setView(null)}
        >
          <defs>
            <clipPath id="history-plot">
              <rect x={PL} y={PT} width={cW} height={cH} />
            </clipPath>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map(f => {
            const v = minY + (maxY - minY) * f;
            return (
              <g key={f}>
                <line x1={PL} x2={width - PR} y1={yOf(v)} y2={yOf(v)} stroke="#e6e0d2" />
                <text x={PL - 8} y={yOf(v) + 3} textAnchor="end" fontSize={10} fill="#6c685f">{money(v)}</text>
              </g>
            );
          })}

          {ticks.map(t => (
            <g key={t}>
              <line x1={xOf(t)} x2={xOf(t)} y1={PT} y2={PT + cH} stroke="#efe9db" />
              <text x={xOf(t)} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill="#6c685f">{fmtDate(t, tickFmt)}</text>
            </g>
          ))}

          <g clipPath="url(#history-plot)">
            {series.map(s => {
              const pts = [...s.points].sort((a, b) => a.date.localeCompare(b.date));
              if (pts.length === 0) return null;
              const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(toMs(p.date)).toFixed(1)} ${yOf(p.equity).toFixed(1)}`).join(" ");
              const showDots = pts.filter(p => toMs(p.date) >= v0 && toMs(p.date) <= v1).length <= 60;
              return (
                <g key={s.name}>
                  <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  {showDots && pts.map(p => (
                    <circle key={p.date} cx={xOf(toMs(p.date))} cy={yOf(p.equity)} r={2.5} fill={s.color} />
                  ))}
                </g>
              );
            })}
          </g>

          {hoverT !== null && (
            <g pointerEvents="none">
              <line x1={xOf(hoverT)} x2={xOf(hoverT)} y1={PT} y2={PT + cH} stroke="#b9b2a2" strokeDasharray="3 3" />
              {hoverRows.map(r => r.equity !== null && (
                <circle key={r.name} cx={xOf(hoverT!)} cy={yOf(r.equity)} r={4.5} fill={r.color} stroke="#f5f2ea" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>

        {hoverT !== null && (
          <div
            className="pointer-events-none absolute top-3 z-10 min-w-40 rounded-md border border-line bg-card px-3.5 py-3 text-sm shadow-sm"
            style={tooltipRight ? { right: width - xOf(hoverT) + 12 } : { left: xOf(hoverT) + 12 }}
          >
            <div className="mb-1 text-neutral-400">{fmtDate(hoverT, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</div>
            {hoverRows.map(r => (
              <div key={r.name} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-neutral-300">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
                  {r.name}
                </span>
                <span className="font-mono tabular-nums">{r.equity === null ? "—" : fullMoney(r.equity)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-muted">
        Scroll to zoom · drag to pan · double-click to reset
      </p>
    </div>
  );
}
