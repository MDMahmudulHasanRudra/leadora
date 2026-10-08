'use client';

import { useState } from 'react';
import { formatAmount, formatNumber } from '@/lib/format';
import type { Dashboard } from '@/lib/types';

/**
 * Single-series magnitude → horizontal bars in one sequential hue (dataviz: no legend for one series,
 * direct value labels, rounded data-end, recessive track, hover tooltip with the exact numbers).
 */
export function StageBars({ stages }: { stages: Dashboard['byStage'] }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...stages.map((s) => s.count));

  return (
    <ul className="space-y-2" aria-label="Leads by stage">
      {stages.map((s) => {
        const pct = (s.count / max) * 100;
        return (
          <li
            key={s.id}
            className="relative grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-sm"
            onMouseEnter={() => setHover(s.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(s.id)}
            onBlur={() => setHover(null)}
            tabIndex={0}
            aria-label={`${s.name}: ${s.count} leads, value ${formatAmount(s.value)}`}
          >
            <span className="truncate text-zinc-600 dark:text-zinc-400">{s.name}</span>
            <span className="h-3 overflow-hidden rounded-r bg-[var(--viz-track)]">
              <span
                className="block h-full rounded-r transition-[width]"
                style={{ width: `${pct}%`, minWidth: s.count ? 4 : 0, backgroundColor: 'var(--viz-bar)' }}
              />
            </span>
            <span className="text-right tabular-nums">{formatNumber(s.count)}</span>
            {hover === s.id && (
              <span
                role="tooltip"
                className="pointer-events-none absolute -top-9 left-28 z-10 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs whitespace-nowrap shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <strong>{s.name}</strong> · {formatNumber(s.count)} leads · value {formatAmount(s.value)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
