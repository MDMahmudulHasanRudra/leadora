import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { apiGet, getIdentity, requireData } from '@/lib/api-server';
import type { AutomationRule, AutomationRun } from '@/lib/types';
import { AutomationsView } from './automations-view';

export const dynamic = 'force-dynamic';

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('automation.view')) redirect('/');
  const canManage = identity.permissions.includes('automation.manage');

  const rules = await apiGet<{ items: AutomationRule[] }>('/automations');
  if (rules.status === 401) redirect('/login');
  if (rules.status === 409) {
    return (
      <>
        <PageHeader title="Automations" />
        <Card className="p-8 text-center text-sm text-zinc-500">
          Automations are turned off for this installation. Your server administrator can enable them with <code>ENABLE_AUTOMATION=true</code>.
        </Card>
      </>
    );
  }
  const runs = await requireData<{ items: AutomationRun[] }>('/automations/runs?limit=50');
  const tab = (await searchParams).tab === 'runs' ? 'runs' : 'rules';

  return (
    <>
      <PageHeader
        title="Automations"
        description="When something happens to a lead, do the follow-up work automatically. Every run is logged."
        actions={
          canManage && (
            <Link href="/automations/new" className="inline-flex h-9 items-center rounded-md bg-brand-600 px-3.5 text-sm font-medium text-white hover:bg-brand-500">
              New automation
            </Link>
          )
        }
      />
      <AutomationsView rules={rules.data?.items ?? []} runs={runs.items} tab={tab} canManage={canManage} timeZone={identity.user.timezone} />
    </>
  );
}
