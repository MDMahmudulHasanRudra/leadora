'use client';

import { useMemo, useState } from 'react';

interface Point {
  date: string;
  newLeads: number;
  conversions: number;
}

// Palette slots 1 and 2 (validated together for light and dark surfaces).
const SERIES = [
  { key: 'newLeads' as const, label: 'New leads', stroke: 'stroke-[#2a78d6] dark:stroke-[#3987e5]', fill: 'fill-[#2a78d6] dark:fill-[#3987e5]', swatch: 'bg-[#2a78d6] dark:bg-[#3987e5]' },
  { key: 'conversions' as const, label: 'Conversions', stroke: 'stroke-[#eb6834] dark:stroke-[#d95926]', fill: 'fill-[#eb6834] dark:fill-[#d95926]', swatch: 'bg-[#eb6834] dark:bg-[#d95926]' },
];

const W = 720;
const H = 220;
const PAD = { top: 12, right: 92, bottom: 26, left: 32 };

const shortDate = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

/** Daily new leads and conversions on one count axis, with a crosshair tooltip and a table view. */
export function TrendChart({ series }: { series: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const { max, ticks, x, y } = useMemo(() => {
    const top = Math.max(1, ...series.flatMap((p) => [p.newLeads, p.conversions]));
    const step = Math.max(1, Math.ceil(top / 4));
    const maxV = step * 4;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    return {
      max: maxV,
      ticks: [0, step, step * 2, step * 3, maxV],
      x: (i: number) => PAD.left + (series.length <= 1 ? innerW / 2 : (i / (series.length - 1)) * innerW),
      y: (v: number) => PAD.top + innerH - (v / maxV) * innerH,
    };
  }, [series]);

  if (series.length === 0) return <p className="text-sm text-zinc-500">No data for this period.</p>;
  const path = (key: 'newLeads' | 'conversions') => series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const labelEvery = Math.ceil(series.length / 6);
  const last = series.length - 1;
  const hovered = hover === null ? null : series[hover]!;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex gap-4 text-xs text-zinc-600 dark:text-zinc-300" aria-label="Legend">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className={`inline-block h-0.5 w-4 rounded ${s.swatch}`} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setAsTable((v) => !v)} className="text-xs text-zinc-500 underline-offset-2 hover:underline">
          {asTable ? 'Show chart' : 'Show as table'}
        </button>
      </div>

      {asTable ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="py-1 font-medium">Day</th>
                <th className="py-1 text-right font-medium">New leads</th>
                <th className="py-1 text-right font-medium">Conversions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 tabular-nums dark:divide-zinc-800">
              {series.map((p) => (
                <tr key={p.date}>
                  <td className="py-1">{shortDate(p.date)}</td>
                  <td className="py-1 text-right">{p.newLeads}</td>
                  <td className="py-1 text-right">{p.conversions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Daily new leads and conversions" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth={1} />
                <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" className="fill-zinc-500 text-[10px] tabular-nums">
                  {t}
                </text>
              </g>
            ))}
            {series.map((p, i) =>
              i % labelEvery === 0 || i === last ? (
                <text key={p.date} x={x(i)} y={H - 8} textAnchor="middle" className="fill-zinc-500 text-[10px]">
                  {shortDate(p.date)}
                </text>
              ) : null,
            )}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-zinc-400 dark:stroke-zinc-500" strokeWidth={1} strokeDasharray="3 3" />}
            {SERIES.map((s) => (
              <g key={s.key}>
                <path d={path(s.key)} fill="none" className={s.stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {/* Direct label at the line end, in text ink; the colored mark beside it carries identity. */}
                <circle cx={x(last)} cy={y(series[last]![s.key])} r={3} className={s.fill} />
                <text x={x(last) + 8} y={y(series[last]![s.key]) + 3} className="fill-zinc-600 text-[10px] dark:fill-zinc-300">
                  {s.label} {series[last]![s.key]}
                </text>
                {hover !== null && <circle cx={x(hover)} cy={y(series[hover]![s.key])} r={4} className={`${s.fill} stroke-white dark:stroke-zinc-900`} strokeWidth={2} />}
              </g>
            ))}
            {/* Hit targets: one full-height band per day, wider than any mark. */}
            {series.map((p, i) => {
              const half = series.length > 1 ? (x(1) - x(0)) / 2 : (W - PAD.left - PAD.right) / 2;
              return <rect key={p.date} x={x(i) - half} y={PAD.top} width={half * 2} height={H - PAD.top - PAD.bottom} fill="transparent" onMouseEnter={() => setHover(i)} />;
            })}
          </svg>
          {hovered && hover !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
              style={{ left: `${Math.min(70, (x(hover) / W) * 100)}%` }}
            >
              <p className="font-medium">{shortDate(hovered.date)}</p>
              {SERIES.map((s) => (
                <p key={s.key} className="flex items-center gap-1.5 tabular-nums text-zinc-600 dark:text-zinc-300">
                  <span className={`inline-block size-2 rounded-full ${s.swatch}`} aria-hidden />
                  {s.label}: <span className="font-medium text-zinc-900 dark:text-zinc-100">{hovered[s.key]}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      <span className="sr-only">Maximum {max}.</span>
    </div>
  );
}
