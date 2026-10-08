import 'server-only';
import { redirect } from 'next/navigation';
import { getIdentity, requireData } from '@/lib/api-server';
import type { AutomationMeta, Page, Pipeline, UserRow } from '@/lib/types';

/** Everything the rule editor needs to offer valid choices. */
export async function loadEditorData() {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('automation.manage')) redirect('/automations');
  const can = (p: string) => identity.permissions.includes(p);
  const [meta, pipelines, users, inboxes] = await Promise.all([
    requireData<AutomationMeta>('/automations/meta'),
    requireData<Page<Pipeline>>('/pipelines'),
    can('user.view') ? requireData<Page<UserRow>>('/users') : Promise.resolve({ items: [] as UserRow[] }),
    can('conversation.view') ? requireData<Page<{ id: string; name: string; channel: string }>>('/inboxes') : Promise.resolve({ items: [] }),
  ]);
  return {
    meta,
    options: {
      stages: (pipelines.items.find((p) => p.isDefault) ?? pipelines.items[0])?.stages.map((s) => ({ key: s.key, name: s.name })) ?? [],
      users: users.items.filter((u) => u.status === 'ACTIVE').map((u) => ({ id: u.id, fullName: u.fullName })),
      inboxes: inboxes.items.filter((i) => i.channel === 'EMAIL').map((i) => ({ id: i.id, name: i.name })),
    },
  };
}