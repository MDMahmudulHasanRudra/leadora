import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import { type Endpoint, WebhooksManager } from './webhooks-manager';

export const dynamic = 'force-dynamic';

export default async function WebhooksPage() {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('settings.manage')) redirect('/');
  const [endpoints, events] = await Promise.all([requireData<{ items: Endpoint[] }>('/webhooks'), requireData<{ items: string[] }>('/webhooks/events')]);
  return (
    <>
      <PageHeader title="Webhooks" description="Send lead and conversation events to your own systems. Every request is signed so you can verify it came from us." />
      <WebhooksManager endpoints={endpoints.items} events={events.items} timeZone={identity.user.timezone} />
    </>
  );
}
