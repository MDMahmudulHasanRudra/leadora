import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Card, formatDateTime } from '@/components/ui';
import { apiGet, getIdentity } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

interface ContactDetail {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  location: string | null;
  createdAt: string;
  company: { id: string; name: string } | null;
  leads: { id: string; fullName: string; convertedAt: string | null; createdAt: string }[];
}

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  const { id } = await params;
  const { data: c } = await apiGet<ContactDetail>(`/contacts/${encodeURIComponent(id)}`);
  if (!c) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/contacts" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          ← Contacts
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{c.fullName}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {c.jobTitle}
          {c.jobTitle && c.company && ' at '}
          {c.company && (
            <Link href={`/companies/${c.company.id}`} className="text-brand-600 hover:underline">
              {c.company.name}
            </Link>
          )}
        </p>
      </div>
      <Card className="p-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          {[
            ['Email', c.email],
            ['Phone', c.phone],
            ['Location', c.location],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-zinc-500">{label}</dt>
              <dd className="mt-0.5">{value ?? <span className="text-zinc-400">—</span>}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Lead history</h2>
        <Card>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {c.leads.map((l) => (
              <li key={l.id} className="flex justify-between px-4 py-3 text-sm">
                <Link href={`/leads/${l.id}`} className="font-medium hover:text-brand-600 hover:underline">
                  {l.fullName}
                </Link>
                <span className="text-xs text-zinc-500">
                  {l.convertedAt ? `Converted ${formatDateTime(l.convertedAt, identity.user.timezone)}` : 'Open'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
