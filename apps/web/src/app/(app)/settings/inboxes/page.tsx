import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import type { Page } from '@/lib/types';
import { InboxesManager } from './inboxes-manager';

export const dynamic = 'force-dynamic';

export default async function InboxesPage() {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('settings.manage')) redirect('/');
  const { items } = await requireData<Page<{ id: string; name: string; channel: string; address: string; enabled: boolean }>>('/inboxes');
  return (
    <>
      <PageHeader title="Inboxes" description="Channel accounts your team sends from and receives on." />
      <InboxesManager inboxes={items} />
    </>
  );
}
