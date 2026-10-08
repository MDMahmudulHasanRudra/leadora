import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import { type FormRow, FormsManager } from './forms-manager';

export const dynamic = 'force-dynamic';

export default async function FormsPage() {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('settings.manage')) redirect('/');
  const forms = await requireData<{ items: FormRow[] }>('/lead-forms');
  return (
    <>
      <PageHeader title="Website forms" description="Put a lead form on your website. Submissions become leads with their source and campaign attached." />
      <FormsManager forms={forms.items} timeZone={identity.user.timezone} />
    </>
  );
}
