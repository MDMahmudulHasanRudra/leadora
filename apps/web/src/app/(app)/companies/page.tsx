import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import type { CompanyRow, Page } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('lead.view')) redirect('/');
  const q = ((await searchParams).q ?? '').slice(0, 100);
  const { items } = await requireData<Page<CompanyRow>>(`/companies${q ? `?q=${encodeURIComponent(q)}` : ''}`);

  return (
    <>
      <PageHeader title="Companies" description="Businesses your contacts work for." />
      <form action="/companies" className="mb-4">
        <input
          name="q"
          defaultValue={q}
          maxLength={100}
          placeholder="Search companies"
          aria-label="Search companies"
          className="h-9 w-full max-w-md rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </form>
      <Card>
        {items.length === 0 ? (
          <p className="p-10 text-center text-sm text-zinc-500">{q ? 'No companies match.' : 'No companies yet.'}</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {items.map((c) => (
              <li key={c.id} className="px-4 py-3 text-sm">
                <Link href={`/companies/${c.id}`} className="font-medium hover:text-brand-600 hover:underline">
                  {c.name}
                </Link>
                {(c.industry || c.domain) && <p className="text-xs text-zinc-500">{[c.industry, c.domain].filter(Boolean).join(' · ')}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
