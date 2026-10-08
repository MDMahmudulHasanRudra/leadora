import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FollowupList } from '@/components/followup-list';
import { Card, PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import type { Followup, Page } from '@/lib/types';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Done' },
] as const;

export default async function FollowupsPage({ searchParams }: { searchParams: Promise<{ status?: string; who?: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('followup.view')) redirect('/');

  const sp = await searchParams;
  const status = TABS.some((t) => t.key === sp.status) ? sp.status! : 'overdue';
  const everyone = sp.who === 'all' && identity.permissions.includes('lead.assign');
  const { items } = await requireData<Page<Followup>>(`/followups?status=${status}${everyone ? '' : '&assignee=me'}`);
  const link = (s: string, who = everyone ? 'all' : 'me') => `/followups?status=${s}&who=${who}`;

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description={everyone ? "Everyone's follow-ups." : 'Calls, emails and meetings you have promised.'}
        actions={
          identity.permissions.includes('lead.assign') && (
            <Link href={link(status, everyone ? 'me' : 'all')} className="text-sm text-brand-600 hover:underline">
              {everyone ? 'Show only mine' : 'Show everyone'}
            </Link>
          )
        }
      />
      <nav className="mb-4 flex gap-1" aria-label="Status">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={link(t.key)}
            aria-current={status === t.key ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 text-sm ${
              status === t.key ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <Card>
        <FollowupList
          items={items}
          timeZone={identity.user.timezone}
          empty={status === 'overdue' ? 'Nothing overdue. Nice work.' : 'Nothing here.'}
        />
      </Card>
    </>
  );
}
