import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import type { Page, Team, UserRow } from '@/lib/types';
import { TeamsManager } from './teams-manager';

export const dynamic = 'force-dynamic';

export default async function TeamsPage() {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('team.view')) redirect('/');

  const canManage = identity.permissions.includes('team.manage');
  const [teams, users] = await Promise.all([
    requireData<Page<Team>>('/teams'),
    canManage && identity.permissions.includes('user.view') ? requireData<Page<UserRow>>('/users') : Promise.resolve({ items: [] }),
  ]);

  return (
    <>
      <PageHeader title="Teams" description="Group people for lead assignment and reporting." />
      <TeamsManager
        teams={teams.items}
        users={users.items.filter((u) => u.status === 'ACTIVE').map(({ id, fullName }) => ({ id, fullName }))}
        canManage={canManage}
      />
    </>
  );
}
