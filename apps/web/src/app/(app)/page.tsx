import { StatTile as Tile } from '@/components/stat-tile';
import { Card, PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import { formatAmount, formatNumber, formatPercent } from '@/lib/format';
import type { Dashboard } from '@/lib/types';
import { StageBars } from './stage-bars';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [identity, d] = await Promise.all([getIdentity(), requireData<Dashboard>('/analytics/dashboard?days=30')]);
  const t = d.totals;

  return (
    <>
      <PageHeader
        title={`Welcome, ${identity?.user.fullName.split(' ')[0] ?? 'there'}`}
        description={d.scope === 'organization' ? 'Your whole organization, last 30 days where noted.' : 'Your leads and follow-ups, last 30 days where noted.'}
      />

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Open leads" value={formatNumber(t.open)} sub={`${formatNumber(t.newInPeriod)} new in 30 days`} href="/leads" />
        <Tile label="Won" value={formatNumber(t.won)} sub={`${formatPercent(t.conversionRate)} of all leads`} />
        <Tile
          label="Pipeline value"
          value={formatAmount(d.value.pipeline)}
          sub={`${formatAmount(d.value.weightedPipeline)} weighted by stage`}
          href="/pipeline"
        />
        <Tile
          label="Follow-ups due (24h)"
          value={formatNumber(t.followupsDueNext24h)}
          sub={t.overdueFollowups ? `${formatNumber(t.overdueFollowups)} overdue` : 'None overdue'}
          alert={t.overdueFollowups > 0}
          href="/followups"
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <h2 className="text-sm font-medium">Leads by stage</h2>
          <p className="mb-4 text-xs text-zinc-500">Active leads in the default pipeline</p>
          <StageBars stages={d.byStage} />
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium">Sources</h2>
          {d.bySource.length === 0 ? (
            <p className="text-sm text-zinc-500">No leads yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr>
                  <th className="pb-2 font-medium">Source</th>
                  <th className="pb-2 text-right font-medium">Leads</th>
                  <th className="pb-2 text-right font-medium">Won</th>
                  <th className="pb-2 text-right font-medium">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 tabular-nums dark:divide-zinc-800">
                {d.bySource.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2">{s.name}</td>
                    <td className="py-2 text-right">{formatNumber(s.leads)}</td>
                    <td className="py-2 text-right">{formatNumber(s.won)}</td>
                    <td className="py-2 text-right">{formatPercent(s.conversionRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {d.team && (
        <Card className="mt-6 overflow-x-auto p-5">
          <h2 className="mb-3 text-sm font-medium">Team performance</h2>
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-left text-xs text-zinc-500">
              <tr>
                <th className="pb-2 font-medium">Member</th>
                <th className="pb-2 text-right font-medium">Leads</th>
                <th className="pb-2 text-right font-medium">Open</th>
                <th className="pb-2 text-right font-medium">Won</th>
                <th className="pb-2 text-right font-medium">Conversion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 tabular-nums dark:divide-zinc-800">
              {d.team.map((m) => (
                <tr key={m.userId}>
                  <td className="py-2">{m.fullName}</td>
                  <td className="py-2 text-right">{formatNumber(m.leads)}</td>
                  <td className="py-2 text-right">{formatNumber(m.open)}</td>
                  <td className="py-2 text-right">{formatNumber(m.won)}</td>
                  <td className="py-2 text-right">{formatPercent(m.conversionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
