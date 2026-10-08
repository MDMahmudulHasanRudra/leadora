import { StatTile } from '@/components/stat-tile';
import { Card } from '@/components/ui';
import { formatNumber } from '@/lib/format';
import type { AiUsage, AiUsageTotals } from '@/lib/types';

const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;

const PURPOSE_LABELS: Record<string, string> = { lead_analysis: 'Lead analysis', connection_test: 'Connection test' };

function Breakdown({ title, rows }: { title: string; rows: (AiUsageTotals & { label: string })[] }) {
  return (
    <Card className="overflow-x-auto p-5">
      <h3 className="mb-3 text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No AI calls this month.</p>
      ) : (
        <table className="w-full min-w-[360px] text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr>
              <th className="pb-2 font-medium" />
              <th className="pb-2 text-right font-medium">Calls</th>
              <th className="pb-2 text-right font-medium">Failed</th>
              <th className="pb-2 text-right font-medium">Tokens</th>
              <th className="pb-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 tabular-nums dark:divide-zinc-800">
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="py-2 pr-3">{r.label}</td>
                <td className="py-2 text-right">{formatNumber(r.calls)}</td>
                <td className="py-2 text-right">{formatNumber(r.failed)}</td>
                <td className="py-2 text-right">{formatNumber(r.inputTokens + r.outputTokens)}</td>
                <td className="py-2 text-right">{usd(r.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function AiUsagePanel({ usage, budget }: { usage: AiUsage; budget: number | null }) {
  const m = usage.month;
  const used = budget ? m.costUsd / budget : null;
  return (
    <section aria-labelledby="ai-usage" className="space-y-3">
      <h2 id="ai-usage" className="font-medium">
        Usage <span className="text-sm font-normal text-zinc-500">· this month (UTC)</span>
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Calls today" value={formatNumber(usage.today.calls)} sub={`${formatNumber(usage.today.failed)} failed`} />
        <StatTile label="Calls this month" value={formatNumber(m.calls)} sub={`${formatNumber(m.failed)} failed`} />
        <StatTile label="Tokens this month" value={formatNumber(m.inputTokens + m.outputTokens)} sub={`${formatNumber(m.inputTokens)} in · ${formatNumber(m.outputTokens)} out`} />
        <StatTile
          label="Estimated cost"
          value={usd(m.costUsd)}
          sub={budget ? `${Math.round((used ?? 0) * 100)}% of the ${usd(budget)} budget` : 'No monthly budget set'}
          alert={used !== null && used >= 0.8}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Breakdown title="By feature" rows={usage.byPurpose.map((r) => ({ ...r, label: PURPOSE_LABELS[r.purpose] ?? r.purpose }))} />
        <Breakdown title="By model" rows={usage.byModel.map((r) => ({ ...r, label: r.model }))} />
        <Breakdown title="By person" rows={usage.byUser.map((r) => ({ ...r, label: r.fullName ?? 'System' }))} />
      </div>
    </section>
  );
}
