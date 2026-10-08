import { notFound, redirect } from 'next/navigation';
import { apiGet, getIdentity, requireData } from '@/lib/api-server';
import type { Activity, CustomFieldDef, Followup, Lead, Page, Pipeline, Task, UserRow } from '@/lib/types';
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
  const [activities, pipelines, users, fields, followups, tasks] = await Promise.all([
    requireData<Page<Activity>>(`/leads/${lead.id}/activities`),
    requireData<Page<Pipeline>>('/pipelines'),
    can('user.view') ? requireData<Page<UserRow>>('/users') : Promise.resolve({ items: [] as UserRow[] }),
    requireData<Page<CustomFieldDef>>('/custom-fields?entity=lead'),
    can('followup.view') ? requireData<Page<Followup>>(`/followups?leadId=${lead.id}&status=all`) : Promise.resolve({ items: [] as Followup[] }),
    can('followup.view') ? requireData<Page<Task>>(`/tasks?leadId=${lead.id}&status=all`) : Promise.resolve({ items: [] as Task[] }),
  ]);

  return (
    <LeadDetail
      lead={lead}
      activities={activities.items}
      followups={followups.items}
      tasks={tasks.items}
      customFields={fields.items}
      stages={pipelines.items.find((p) => p.id === lead.pipelineId)?.stages ?? []}
      users={users.items.map(({ id, fullName, status }) => ({ id, fullName, active: status === 'ACTIVE' }))}
      timeZone={identity.user.timezone}
      can={{ update: can('lead.update'), assign: can('lead.assign'), archive: can('lead.delete'), followup: can('followup.create') }}
    />
  );
}
