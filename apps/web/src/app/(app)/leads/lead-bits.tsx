import { Badge } from '@/components/ui';
import type { Lead, Priority, Stage } from '@/lib/types';

export function StageBadge({ stage }: { stage: Pick<Stage, 'name' | 'color'> }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-0.5 text-xs font-medium whitespace-nowrap dark:border-zinc-700">
      <span className="size-2 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden />
      {stage.name}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const tone = priority === 'URGENT' || priority === 'HIGH' ? 'red' : priority === 'LOW' ? 'neutral' : 'brand';
  return <Badge tone={tone}>{priority.toLowerCase()}</Badge>;
}

export const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** Score with its temperature as text, so meaning never rests on color alone. */
export function ScoreBadge({ score, temperature }: Pick<Lead, 'score' | 'temperature'>) {
  if (score === null) return <span className="text-zinc-400">—</span>;
  const tone = temperature === 'HOT' ? 'red' : temperature === 'WARM' ? 'brand' : 'neutral';
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="w-6 text-right font-medium tabular-nums">{score}</span>
      {temperature && <Badge tone={tone}>{temperature.toLowerCase()}</Badge>}
    </span>
  );
}