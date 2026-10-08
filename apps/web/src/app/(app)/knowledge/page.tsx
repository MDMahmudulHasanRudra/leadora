import { redirect } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { apiGet, getIdentity, requireData } from '@/lib/api-server';
import type { KbCollection, KbDocument } from '@/lib/types';
import { KnowledgeView } from './knowledge-view';

export const dynamic = 'force-dynamic';

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('knowledge.view')) redirect('/');
  const can = (p: string) => identity.permissions.includes(p);

  const collections = await apiGet<{ items: KbCollection[] }>('/kb/collections');
  if (collections.status === 401) redirect('/login');
  if (collections.status === 409) {
    return (
      <>
        <PageHeader title="Knowledge Base" />
        <Card className="p-8 text-center text-sm text-zinc-500">
          The knowledge base is turned off for this installation. Your server administrator can enable it with <code>ENABLE_KNOWLEDGE_BASE=true</code>.
        </Card>
      </>
    );
  }
  const items = collections.data?.items ?? [];
  const sp = await searchParams;
  const selected = items.find((c) => c.id === sp.c) ?? items[0] ?? null;
  const [documents, teams] = await Promise.all([
    selected ? requireData<{ items: KbDocument[] }>(`/kb/documents?collectionId=${selected.id}`) : Promise.resolve({ items: [] as KbDocument[] }),
    can('knowledge.manage') && can('team.view') ? requireData<{ items: { id: string; name: string }[] }>('/teams') : Promise.resolve({ items: [] }),
  ]);

  return (
    <>
      <PageHeader title="Knowledge Base" description="Company documents the AI answers from, with sources. People only see collections they have access to." />
      <KnowledgeView
        collections={items}
        selected={selected}
        documents={documents.items}
        teams={teams.items.map(({ id, name }) => ({ id, name }))}
        timeZone={identity.user.timezone}
        can={{ manage: can('knowledge.manage'), ask: can('ai.use'), configure: can('ai.configure') }}
      />
    </>
  );
}
