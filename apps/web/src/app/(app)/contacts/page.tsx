import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import type { ContactRow, Page } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('lead.view')) redirect('/');
  const q = ((await searchParams).q ?? '').slice(0, 100);
  const { items } = await requireData<Page<ContactRow>>(`/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`);

  return (
    <>
      <PageHeader title="Contacts" description="People who became customers. Convert a lead to add one." />
      <form action="/contacts" className="mb-4">
        <input
          name="q"
          defaultValue={q}
          maxLength={100}
          placeholder="Search name, email, phone or company"
          aria-label="Search contacts"
          className="h-9 w-full max-w-md rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </form>
      <Card className="overflow-x-auto">
        {items.length === 0 ? (
          <p className="p-10 text-center text-sm text-zinc-500">{q ? 'No contacts match.' : 'No contacts yet.'}</p>
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Phone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {items.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <Link href={`/contacts/${c.id}`} className="font-medium hover:text-brand-600 hover:underline">
                      {c.fullName}
                    </Link>
                    {c.jobTitle && <div className="text-xs text-zinc-500">{c.jobTitle}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {c.companyId ? (
                      <Link href={`/companies/${c.companyId}`} className="hover:underline">
                        {c.companyName}
                      </Link>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{c.email ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-600 tabular-nums dark:text-zinc-400">{c.phone ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
