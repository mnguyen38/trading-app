export type ChartSeries = { name: string; color: string; points: { date: string; equity: number }[] };

const W = 600;
const H = 160;
const PT = 8;   // pad top
const PR = 8;   // pad right
const PB = 22;  // pad bottom
const PL = 60;  // pad left (y labels)

export function EquityChart({ series }: { series: ChartSeries[] }) {
  const allPts = series.flatMap(s => s.points);
  if (allPts.length === 0) return null;

  const allDates = [...new Set(allPts.map(p => p.date))].sort();
  const allEquities = allPts.map(p => p.equity);
  const rawMin = Math.min(...allEquities);
  const rawMax = Math.max(...allEquities);
  const pad = rawMax !== rawMin ? (rawMax - rawMin) * 0.12 : rawMax * 0.02;
  const minE = rawMin - pad;
  const maxE = rawMax + pad;

  const cW = W - PL - PR;
  const cH = H - PT - PB;
  const n = Math.max(allDates.length - 1, 1);

  function xOf(date: string) {
    return PL + (allDates.indexOf(date) / n) * cW;
  }
  function yOf(e: number) {
    return PT + (1 - (e - minE) / (maxE - minE)) * cH;
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden="true">
      {/* grid */}
      <line x1={PL} y1={PT}      x2={W - PR} y2={PT}      stroke="#262626" strokeWidth={1} />
      <line x1={PL} y1={PT + cH} x2={W - PR} y2={PT + cH} stroke="#262626" strokeWidth={1} />

      {/* y labels */}
      <text x={PL - 6} y={PT + 4}      textAnchor="end" fontSize={10} fill="#525252">{moneyK(maxE)}</text>
      <text x={PL - 6} y={PT + cH + 1} textAnchor="end" fontSize={10} fill="#525252">{moneyK(minE)}</text>

      {/* x labels */}
      {allDates.length > 1 && <>
        <text x={PL}        y={H - 5} textAnchor="start" fontSize={10} fill="#525252">{mmdd(allDates[0])}</text>
        <text x={W - PR}    y={H - 5} textAnchor="end"   fontSize={10} fill="#525252">{mmdd(allDates[allDates.length - 1])}</text>
      </>}

      {/* series */}
      {series.map(s => {
        if (s.points.length === 0) return null;
        const sorted = [...s.points].sort((a, b) => a.date.localeCompare(b.date));
        const d = sorted
          .map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(p.date).toFixed(1)} ${yOf(p.equity).toFixed(1)}`)
          .join(" ");
        return (
          <g key={s.name}>
            <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {sorted.map(p => (
              <circle key={p.date} cx={xOf(p.date)} cy={yOf(p.equity)} r={3} fill={s.color} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function moneyK(v: number): string {
  return Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
}

function mmdd(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}
