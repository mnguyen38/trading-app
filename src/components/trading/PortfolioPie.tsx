const COLORS = [
  "#f97316", // orange
  "#3b82f6", // blue
  "#a855f7", // purple
  "#14b8a6", // teal
  "#eab308", // yellow
  "#ec4899", // pink
  "#22c55e", // green
  "#06b6d4", // cyan
];

type Slice = { label: string; value: number; color: string };

function polarToCartesian(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutPath(cx: number, cy: number, ro: number, ri: number, start: number, end: number) {
  if (end - start >= 360) end = start + 359.9999;
  const so = polarToCartesian(cx, cy, ro, start);
  const eo = polarToCartesian(cx, cy, ro, end);
  const si = polarToCartesian(cx, cy, ri, end);
  const ei = polarToCartesian(cx, cy, ri, start);
  const large = end - start > 180 ? 1 : 0;
  return [
    `M ${so.x} ${so.y}`,
    `A ${ro} ${ro} 0 ${large} 1 ${eo.x} ${eo.y}`,
    `L ${si.x} ${si.y}`,
    `A ${ri} ${ri} 0 ${large} 0 ${ei.x} ${ei.y}`,
    "Z",
  ].join(" ");
}

type Props = {
  positions: { symbol: string; market_value: string }[];
  equity: number;
  cash: number;
};

export function PortfolioPie({ positions, equity, cash }: Props) {
  const slices: Slice[] = [
    ...positions.map((p, i) => ({
      label: p.symbol,
      value: Math.max(0, parseFloat(p.market_value)),
      color: COLORS[i % COLORS.length],
    })),
    { label: "Cash", value: Math.max(0, cash), color: "#404040" },
  ].filter(s => s.value > 0);

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return null;

  const cx = 100, cy = 100, ro = 92, ri = 60;
  let cursor = 0;

  return (
    <div className="mb-6 flex flex-col items-center gap-5">
      <svg viewBox="0 0 200 200" className="w-56">
        {slices.map(s => {
          const sweep = (s.value / total) * 360;
          const path = donutPath(cx, cy, ro, ri, cursor, cursor + sweep);
          cursor += sweep;
          return <path key={s.label} d={path} fill={s.color} />;
        })}
        <text x={cx} y={cy - 7} textAnchor="middle" fill="#e5e5e5" fontSize="13" fontWeight="600">
          {`$${(equity / 1000).toFixed(1)}k`}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="#737373" fontSize="9">
          portfolio
        </text>
      </svg>

      {/* Legend — 2-col grid, centered */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs">
        {slices.map(s => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="text-neutral-400">{s.label}</span>
            <span className="ml-auto font-mono text-neutral-500">
              {((s.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
