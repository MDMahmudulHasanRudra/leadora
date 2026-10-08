import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import type { Page, UserRow } from '@/lib/types';
import { ImportWizard, type ImportSummary } from './import-wizard';

export const dynamic = 'force-dynamic';

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('lead.import')) redirect('/leads');

  const { id } = await searchParams;
  const canAssign = identity.permissions.includes('lead.assign') && identity.permissions.includes('user.view');
  const [recent, users] = await Promise.all([
    requireData<Page<ImportSummary>>('/lead-imports'),
    canAssign ? requireData<Page<UserRow>>('/users') : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title="Import leads"
        description="Upload a CSV exported from a spreadsheet or another CRM. Up to 20,000 rows and 5 MB."
        actions={
          <Link href="/leads" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
            ← Back to leads
          </Link>
        }
      />
      <ImportWizard
        key={id ?? 'new'}
        initialImportId={typeof id === 'string' ? id : undefined}
        recent={recent.items}
        owners={users?.items.filter((u) => u.status === 'ACTIVE').map(({ id: uid, fullName }) => ({ id: uid, fullName })) ?? null}
        currentUserId={identity.user.id}
        timeZone={identity.user.timezone}
      />
    </>
  );
}
