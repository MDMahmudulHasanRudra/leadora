import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import type { CustomFieldDef, Page, Pipeline, UserRow } from '@/lib/types';
import { NewLeadForm } from './new-lead-form';

export const dynamic = 'force-dynamic';

export default async function NewLeadPage() {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('lead.create')) redirect('/leads');

  const canAssign = identity.permissions.includes('lead.assign') && identity.permissions.includes('user.view');
  const [pipelines, users, fields] = await Promise.all([
    requireData<Page<Pipeline>>('/pipelines'),
    canAssign ? requireData<Page<UserRow>>('/users') : Promise.resolve(null),
    requireData<Page<CustomFieldDef>>('/custom-fields?entity=lead'),
  ]);
  const me = { id: identity.user.id, fullName: `${identity.user.fullName} (me)` };
  const owners = users
    ? [me, ...users.items.filter((u) => u.status === 'ACTIVE' && u.id !== identity.user.id).map(({ id, fullName }) => ({ id, fullName }))]
    : undefined;

  return (
    <>
      <PageHeader
        title="New lead"
        actions={
          <Link href="/leads" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
            ← Back to leads
          </Link>
        }
      />
      <Card className="p-5">
        <NewLeadForm stages={pipelines.items[0]?.stages ?? []} owners={owners} customFields={fields.items} />
      </Card>
    </>
  );
}
