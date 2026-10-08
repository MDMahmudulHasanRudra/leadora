import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import type { Lead, Page, Pipeline, Stage } from '@/lib/types';
import { Board } from './board';

export const dynamic = 'force-dynamic';

export interface BoardColumn extends Stage {
  count: number;
  leads: Lead[];
}

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('lead.view')) redirect('/');

  const { owner } = await searchParams;
  const mine = owner === 'me';
  const { items } = await requireData<Page<Pipeline>>('/pipelines');
  const pipeline = items.find((p) => p.isDefault) ?? items[0];
  if (!pipeline) return <PageHeader title="Pipeline" description="No pipeline configured." />;
  const board = await requireData<{ stages: BoardColumn[] }>(`/pipelines/${pipeline.id}/board${mine ? '?owner=me' : ''}`);

  const tab = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm ${active ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'}`;

  return (
    <>
      <PageHeader
        title={pipeline.name}
        description="Drag a card to move the lead to another stage."
        actions={
          <nav className="flex gap-1" aria-label="Filter">
            <Link href="/pipeline" className={tab(!mine)} aria-current={!mine ? 'page' : undefined}>
              All leads
            </Link>
            <Link href="/pipeline?owner=me" className={tab(mine)} aria-current={mine ? 'page' : undefined}>
              My leads
            </Link>
          </nav>
        }
      />
      <Board key={mine ? 'me' : 'all'} initial={board.stages} canMove={identity.permissions.includes('lead.update')} />
    </>
  );
}
