import { notFound, redirect } from 'next/navigation';
import { apiGet, getIdentity, requireData } from '@/lib/api-server';
import type { Activity, Lead, Page, Pipeline, UserRow } from '@/lib/types';
import { LeadDetail } from './lead-detail';

export const dynamic = 'force-dynamic';

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('lead.view')) redirect('/');

  const { status, data: lead } = await apiGet<Lead>(`/leads/${encodeURIComponent(id)}`);
  if (status === 404 || !lead) notFound();

  const can = (p: string) => identity.permissions.includes(p);
  const [activities, pipelines, users] = await Promise.all([
    requireData<Page<Activity>>(`/leads/${lead.id}/activities`),
    requireData<Page<Pipeline>>('/pipelines'),
    can('user.view') ? requireData<Page<UserRow>>('/users') : Promise.resolve({ items: [] as UserRow[] }),
  ]);

  return (
    <LeadDetail
      lead={lead}
      activities={activities.items}
      stages={pipelines.items.find((p) => p.id === lead.pipelineId)?.stages ?? []}
      users={users.items.map(({ id, fullName, status }) => ({ id, fullName, active: status === 'ACTIVE' }))}
      timeZone={identity.user.timezone}
      can={{ update: can('lead.update'), assign: can('lead.assign'), archive: can('lead.delete') }}
    />
  );
}
