import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import { AssistantView, type HistoryItem } from './assistant-view';

export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('ai.use')) redirect('/');
  const history = await requireData<{ items: HistoryItem[] }>('/ai/assistant/history');
  return (
    <>
      <PageHeader title="AI Assistant" description="Ask about your leads, follow-ups, team and sources in plain words. It only reads data you can already see." />
      <AssistantView
        history={history.items}
        timeZone={identity.user.timezone}
        canConfigure={identity.permissions.includes('ai.configure')}
      />
    </>
  );
}
