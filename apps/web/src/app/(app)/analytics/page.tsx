import Link from 'next/link';
import { redirect } from 'next/navigation';
import { StatTile } from '@/components/stat-tile';
import { Card, PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import { formatAmount, formatNumber, formatPercent } from '@/lib/format';
import { RefreshInsights } from './refresh-insights';
import { TrendChart } from './trend-chart';

export const dynamic = 'force-dynamic';

const PERIODS = [7, 30, 90, 365];

interface Overview {
  totals: {
    totalLeads: number;
    openLeads: number;
    newLeads: number;
    contacted: number;
    qualified: number;
    converted: number;
    lost: number;
    conversionRate: number;
    avgResponseHours: number | null;
    avgSalesCycleDays: number | null;
    revenue: number;
    followupsOverdue: number;
  };
  series: { date: string; newLeads: number; conversions: number }[];
}
interface Insight {
  id: string;
  key: string;
  title: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  evidence: { summary: string; items?: { label: string; value?: string | number; link?: string }[] };
  recommendedAction: string;
  generatedAt: string;
}

// Status colors are reserved for state and always paired with an icon and a word.
const SEVERITY = {
  CRITICAL: { icon: '⛔', label: 'Critical', className: 'text-[#d03b3b]' },
  WARNING: { icon: '⚠', label: 'Warning', className: 'text-[#b07800] dark:text-[#fab219]' },
  INFO: { icon: 'ℹ', label: 'Info', className: 'text-zinc-500' },
};

const hours = (h: number | null) => (h === null ? '—' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('analytics.view')) redirect('/');
  const requested = Number((await searchParams).days);
  const days = PERIODS.includes(requested) ? requested : 30;

  const [o, sources, team, forecast, insights] = await Promise.all([
    requireData<Overview>(`/analytics/overview?days=${days}`),
    requireData<{ items: { id: string; name: string; leads: number; qualified: number; converted: number; conversionRate: number; revenue: number }[] }>(`/analytics/sources?days=${days}`),
    requireData<{
      items: { userId: string; fullName: string; assigned: number; contacted: number; qualified: number; converted: number; conversionRate: number; avgResponseHours: number | null; followupCompletion: number | null }[];
    }>(`/analytics/team?days=${days}`),
    requireData<{
      stages: { id: string; name: string; outcome: string; probability: number; count: number; value: number; weighted: number }[];
      totals: { pipelineValue: number; weightedPipeline: number; wonValue: number; lostValue: number; openDeals: number };
    }>('/analytics/forecast'),
    requireData<{ items: Insight[] }>('/analytics/insights'),
  ]);
  const t = o.totals;
  const openStages = forecast.stages.filter((s) => s.outcome === 'OPEN');
  const maxWeighted = Math.max(1, ...openStages.map((s) => s.weighted));

  return (
    <>
      <PageHeader
        title="Analytics"
        description="How leads arrive, move and convert. Every number comes straight from your CRM data."
        actions={
          <nav className="flex rounded-md border border-zinc-200 text-sm dark:border-zinc-700" aria-label="Period">
            {PERIODS.map((p) => (
              <Link
                key={p}
                href={`/analytics?days=${p}`}
                aria-current={p === days ? 'page' : undefined}
                className={`px-3 py-1.5 ${p === days ? 'bg-brand-50 font-medium text-brand-600 dark:bg-zinc-800 dark:text-white' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800'}`}
              >
                {p === 365 ? '1 year' : `${p} days`}
              </Link>
            ))}
          </nav>
        }
      />

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="New leads" value={formatNumber(t.newLeads)} sub={`${formatNumber(t.contacted)} contacted · ${formatNumber(t.qualified)} qualified`} href="/leads" />
        <StatTile label="Conversions" value={formatNumber(t.converted)} sub={`${formatPercent(t.conversionRate)} of new leads · ${formatNumber(t.lost)} lost`} />
        <StatTile label="Revenue won" value={formatAmount(t.revenue)} sub={t.avgSalesCycleDays === null ? 'No deals won yet' : `${t.avgSalesCycleDays.toFixed(1)} days average sales cycle`} />
        <StatTile
          label="First response"
          value={hours(t.avgResponseHours)}
          sub={t.followupsOverdue ? `${formatNumber(t.followupsOverdue)} follow-ups overdue` : 'No follow-ups overdue'}
          alert={t.followupsOverdue > 0}
          href="/followups"
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <h2 className="text-sm font-medium">New leads and conversions per day</h2>
          <p className="mb-3 text-xs text-zinc-500">Last {days} days, UTC</p>
          <TrendChart series={o.series} />
        </Card>
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">Insights</h2>
            <RefreshInsights />
          </div>
          {insights.items.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing needs attention right now.</p>
          ) : (
            <ul className="space-y-3">
              {insights.items.map((i) => {
                const sev = SEVERITY[i.severity];
                return (
                  <li key={i.id} className="text-sm">
                    <p className="font-medium">
                      <span className={sev.className}>
                        <span aria-hidden>{sev.icon}</span> <span className="sr-only">{sev.label}: </span>
                      </span>
                      {i.title}
                    </p>
                    <p className="text-xs text-zinc-500">{i.evidence.summary}</p>
                    {i.evidence.items && i.evidence.items.length > 0 && (
                      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                        {i.evidence.items.map((e) => (
                          <li key={e.label}>
                            {e.link ? (
                              <Link href={e.link} className="text-brand-600 hover:underline">
                                {e.label}
                              </Link>
                            ) : (
                              e.label
                            )}
                            {e.value !== undefined && <span className="text-zinc-500 tabular-nums"> · {e.value}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-xs text-zinc-700 dark:text-zinc-300">→ {i.recommendedAction}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="overflow-x-auto p-5">
          <h2 className="mb-3 text-sm font-medium">Sources</h2>
          {sources.items.length === 0 ? (
            <p className="text-sm text-zinc-500">No leads in this period.</p>
          ) : (
            <table className="w-full min-w-[420px] text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr>
                  <th className="pb-2 font-medium">Source</th>
                  <th className="pb-2 text-right font-medium">Leads</th>
                  <th className="pb-2 text-right font-medium">Qualified</th>
                  <th className="pb-2 text-right font-medium">Won</th>
                  <th className="pb-2 text-right font-medium">Rate</th>
                  <th className="pb-2 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 tabular-nums dark:divide-zinc-800">
                {sources.items.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2">{s.name}</td>
                    <td className="py-2 text-right">{formatNumber(s.leads)}</td>
                    <td className="py-2 text-right">{formatNumber(s.qualified)}</td>
                    <td className="py-2 text-right">{formatNumber(s.converted)}</td>
                    <td className="py-2 text-right">{formatPercent(s.conversionRate)}</td>
                    <td className="py-2 text-right">{formatAmount(s.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-medium">Pipeline forecast</h2>
          <p className="mb-3 text-xs text-zinc-500">
            {formatNumber(forecast.totals.openDeals)} open deals · {formatAmount(forecast.totals.pipelineValue)} in the pipeline · {formatAmount(forecast.totals.weightedPipeline)} weighted by stage
            probability
          </p>
          <ul className="space-y-2">
            {openStages.map((s) => (
              <li key={s.id} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate">{s.name}</span>
                <span className="h-2 rounded-sm bg-zinc-100 dark:bg-zinc-800" aria-hidden>
                  <span className="block h-2 rounded-sm bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${(s.weighted / maxWeighted) * 100}%` }} />
                </span>
                <span className="text-xs text-zinc-600 tabular-nums dark:text-zinc-300">
                  {formatAmount(s.weighted)} <span className="text-zinc-400">({s.count} × {s.probability}%)</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-zinc-500 tabular-nums">
            Won {formatAmount(forecast.totals.wonValue)} · Lost {formatAmount(forecast.totals.lostValue)} · values are lead budgets, not converted between currencies
          </p>
        </Card>
      </div>

      <Card className="mt-6 overflow-x-auto p-5">
        <h2 className="mb-3 text-sm font-medium">Team</h2>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr>
              <th className="pb-2 font-medium">Person</th>
              <th className="pb-2 text-right font-medium">Assigned</th>
              <th className="pb-2 text-right font-medium">Contacted</th>
              <th className="pb-2 text-right font-medium">Qualified</th>
              <th className="pb-2 text-right font-medium">Won</th>
              <th className="pb-2 text-right font-medium">Conversion</th>
              <th className="pb-2 text-right font-medium">First response</th>
              <th className="pb-2 text-right font-medium">Follow-ups done</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 tabular-nums dark:divide-zinc-800">
            {team.items.map((m) => (
              <tr key={m.userId}>
                <td className="py-2">{m.fullName}</td>
                <td className="py-2 text-right">{formatNumber(m.assigned)}</td>
                <td className="py-2 text-right">{formatNumber(m.contacted)}</td>
                <td className="py-2 text-right">{formatNumber(m.qualified)}</td>
                <td className="py-2 text-right">{formatNumber(m.converted)}</td>
                <td className="py-2 text-right">{formatPercent(m.conversionRate)}</td>
                <td className="py-2 text-right">{hours(m.avgResponseHours)}</td>
                <td className="py-2 text-right">{m.followupCompletion === null ? '—' : formatPercent(m.followupCompletion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {identity.permissions.includes('ai.configure') && (
        <p className="mt-4 text-xs text-zinc-500">
          AI usage and cost are in{' '}
          <Link href="/settings/ai" className="text-brand-600 hover:underline">
            Settings → AI
          </Link>
          .
        </p>
      )}
    </>
  );
}
