import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import type { Page, UserRow } from '@/lib/types';
import { UsersManager } from './users-manager';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('user.view')) redirect('/');
  const { items } = await requireData<Page<UserRow>>('/users');

  return (
    <>
      <PageHeader title="Users" description="People who can sign in to your organization." />
      <UsersManager
        users={items}
        currentUserId={identity.user.id}
        timeZone={identity.user.timezone}
        can={{
          create: identity.permissions.includes('user.create'),
          update: identity.permissions.includes('user.update'),
          disable: identity.permissions.includes('user.disable'),
        }}
      />
    </>
  );
}
