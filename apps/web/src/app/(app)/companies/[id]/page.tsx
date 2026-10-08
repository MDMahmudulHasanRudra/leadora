import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Card } from '@/components/ui';
import { apiGet, getIdentity } from '@/lib/api-server';
import type { ContactRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getIdentity())) redirect('/login');
  const { id } = await params;
  const { data: company } = await apiGet<{ id: string; name: string; industry: string | null; domain: string | null; contacts: ContactRow[] }>(
    `/companies/${encodeURIComponent(id)}`,
  );
  if (!company) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/companies" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          ← Companies
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{company.name}</h1>
        {(company.industry || company.domain) && (
          <p className="mt-1 text-sm text-zinc-500">{[company.industry, company.domain].filter(Boolean).join(' · ')}</p>
        )}
      </div>
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">People</h2>
        <Card>
          {company.contacts.length === 0 ? (
            <p className="p-6 text-center text-sm text-zinc-500">No contacts yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {company.contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm">
                  <span>
                    <Link href={`/contacts/${c.id}`} className="font-medium hover:text-brand-600 hover:underline">
                      {c.fullName}
                    </Link>
                    {c.jobTitle && <span className="text-zinc-500"> · {c.jobTitle}</span>}
                  </span>
                  <span className="text-zinc-500">{c.email ?? c.phone ?? ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
