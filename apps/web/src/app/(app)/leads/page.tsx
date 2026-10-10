import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, formatDateTime, PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import { type Lead, type Page, type Pipeline, PRIORITIES, type UserRow } from '@/lib/types';
import { ExportButton } from './export-button';
import { PriorityBadge, ScoreBadge, StageBadge, titleCase } from './lead-bits';

export const dynamic = 'force-dynamic';

const FILTERS = ['q', 'owner', 'stageId', 'priority', 'temperature', 'tag', 'archived', 'cursor'] as const;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const selectClass =
  'h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900';

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('lead.view')) redirect('/');

  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const key of FILTERS) {
    const v = raw[key];
    if (typeof v === 'string' && v) params.set(key, v);
  }

  // Without lead.view_all the API returns only your own and unassigned leads, so other owners are not offered.
  const seesAll = identity.permissions.includes('lead.view_all');
  const canSeeUsers = seesAll && identity.permissions.includes('user.view');
  const [leads, pipelines, users] = await Promise.all([
    requireData<Page<Lead>>(`/leads?limit=25&${params}`),
    requireData<Page<Pipeline>>('/pipelines'),
    canSeeUsers ? requireData<Page<UserRow>>('/users') : Promise.resolve({ items: [] as UserRow[] }),
  ]);
  const stages = pipelines.items[0]?.stages ?? [];
  const filtered = [...params.keys()].some((k) => k !== 'cursor');
  const nextParams = new URLSearchParams(params);
  if (leads.nextCursor) nextParams.set('cursor', leads.nextCursor);

  return (
    <>
      <PageHeader
        title={params.get('archived') === 'true' ? 'Archived leads' : 'Leads'}
        description={seesAll ? 'Everyone who might buy from you, newest first.' : 'Your leads and unassigned leads, newest first.'}
        actions={
          <div className="flex gap-2">
            {identity.permissions.includes('lead.export') && <ExportButton filters={Object.fromEntries(params)} />}
            {identity.permissions.includes('lead.import') && (
              <Link
                href="/leads/import"
                className="inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-3.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              >
                Import CSV
              </Link>
            )}
            {identity.permissions.includes('lead.create') && (
              <Link
                href="/leads/new"
                className="inline-flex h-9 items-center rounded-md bg-brand-600 px-3.5 text-sm font-medium text-white hover:bg-brand-500"
              >
                New lead
              </Link>
            )}
          </div>
        }
      />

      <form className="mb-4 flex flex-wrap gap-2" action="/leads">
        <input
          name="q"
          defaultValue={params.get('q') ?? ''}
          placeholder="Search name, email, phone, company"
          maxLength={100}
          aria-label="Search leads"
          className="h-9 min-w-56 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <select name="owner" defaultValue={params.get('owner') ?? ''} aria-label="Owner" className={selectClass}>
          <option value="">Any owner</option>
          <option value="me">Mine</option>
          <option value="unassigned">Unassigned</option>
          {users.items
            .filter((u) => u.id !== identity.user.id)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
        </select>
        <select name="stageId" defaultValue={params.get('stageId') ?? ''} aria-label="Stage" className={selectClass}>
          <option value="">Any stage</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select name="priority" defaultValue={params.get('priority') ?? ''} aria-label="Priority" className={selectClass}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {titleCase(p)}
            </option>
          ))}
        </select>
        <select name="temperature" defaultValue={params.get('temperature') ?? ''} aria-label="Temperature" className={selectClass}>
          <option value="">Any temperature</option>
          <option value="HOT">Hot</option>
          <option value="WARM">Warm</option>
          <option value="COLD">Cold</option>
        </select>
        <select name="archived" defaultValue={params.get('archived') ?? ''} aria-label="Archived" className={selectClass}>
          <option value="">Active</option>
          <option value="true">Archived</option>
        </select>
        <button className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800">
          Apply
        </button>
        {filtered && (
          <Link href="/leads" className="inline-flex h-9 items-center px-2 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
            Clear
          </Link>
        )}
      </form>

      <Card className="overflow-x-auto">
        {leads.items.length === 0 ? (
          <div className="p-10 text-center text-sm text-zinc-500">
            {filtered ? 'No leads match these filters.' : 'No leads yet. Add your first one to get started.'}
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3 font-medium">Lead</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {leads.items.map((lead) => (
                <tr key={lead.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <td className="px-4 py-3">
                    <Link href={`/leads/${lead.id}`} className="font-medium hover:text-brand-600 hover:underline">
                      {lead.fullName}
                    </Link>
                    <div className="text-xs text-zinc-500">
                      {[lead.companyName, lead.email ?? lead.phone].filter(Boolean).join(' · ')}
                    </div>
                    {lead.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {lead.tags.map((tag) => (
                          <span key={tag} className="rounded bg-zinc-100 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ScoreBadge score={lead.score} temperature={lead.temperature} />
                  </td>
                  <td className="px-4 py-3">
                    <StageBadge stage={lead.stage} />
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{lead.owner?.fullName ?? <span className="text-zinc-400">Unassigned</span>}</td>
                  <td className="px-4 py-3">
                    <PriorityBadge priority={lead.priority} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-zinc-500">{formatDateTime(lead.createdAt, identity.user.timezone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {(params.has('cursor') || leads.nextCursor) && (
        <nav className="mt-4 flex justify-between text-sm" aria-label="Pagination">
          {params.has('cursor') ? (
            <Link href={`/leads?${new URLSearchParams([...params].filter(([k]) => k !== 'cursor'))}`} className="text-brand-600 hover:underline">
              ← First page
            </Link>
          ) : (
            <span />
          )}
          {leads.nextCursor && (
            <Link href={`/leads?${nextParams}`} className="text-brand-600 hover:underline">
              Next page →
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
