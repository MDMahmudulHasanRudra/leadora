import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import { type ApiKeyRow, ApiKeysManager } from './api-keys-manager';

export const dynamic = 'force-dynamic';

export default async function ApiKeysPage() {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('settings.manage')) redirect('/');
  const [keys, scopes] = await Promise.all([
    requireData<{ items: ApiKeyRow[] }>('/api-keys'),
    requireData<{ items: { key: string; permissions: string[] }[] }>('/api-keys/scopes'),
  ]);
  return (
    <>
      <PageHeader title="API keys" description="Let your own systems read and create leads through the REST API. Keys act as you, limited to the scopes you choose." />
      <ApiKeysManager keys={keys.items} scopes={scopes.items.map((s) => s.key)} timeZone={identity.user.timezone} />
    </>
  );
}
