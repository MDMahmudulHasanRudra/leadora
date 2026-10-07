import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import type { AuditEntry, Page } from '@/lib/types';
import { AuditTable } from './audit-table';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('audit.view')) redirect('/');
  const first = await requireData<Page<AuditEntry>>('/audit-logs?limit=50');

  return (
    <>
      <PageHeader title="Audit log" description="Every sign-in and administrative change, newest first." />
      <AuditTable initial={first} timeZone={identity.user.timezone} />
    </>
  );
}
