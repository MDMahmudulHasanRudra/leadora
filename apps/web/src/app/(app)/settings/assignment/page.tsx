import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import type { AssignmentRule, Page, Team, UserRow } from '@/lib/types';
import { RulesManager } from './rules-manager';

export const dynamic = 'force-dynamic';

export default async function AssignmentPage() {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('settings.manage')) redirect('/');
  const [rules, users, teams] = await Promise.all([
    requireData<Page<AssignmentRule>>('/assignment-rules'),
    requireData<Page<UserRow>>('/users'),
    requireData<Page<Team>>('/teams'),
  ]);

  return (
    <>
      <PageHeader
        title="Assignment rules"
        description="Who gets new leads from imports and other automatic sources. Rules are checked top to bottom; the first match wins."
      />
      <RulesManager
        rules={rules.items}
        users={users.items.filter((u) => u.status === 'ACTIVE').map(({ id, fullName }) => ({ id, fullName }))}
        teams={teams.items.map(({ id, name }) => ({ id, name }))}
      />
    </>
  );
}
