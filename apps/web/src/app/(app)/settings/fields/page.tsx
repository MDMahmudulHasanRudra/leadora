import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import type { CustomFieldDef, Page } from '@/lib/types';
import { FieldsManager } from './fields-manager';

export const dynamic = 'force-dynamic';

export default async function CustomFieldsPage() {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('settings.manage')) redirect('/');
  const { items } = await requireData<Page<CustomFieldDef>>('/custom-fields?entity=lead');

  return (
    <>
      <PageHeader title="Custom fields" description="Extra information your team records on every lead." />
      <FieldsManager fields={items} />
    </>
  );
}
