import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getIdentity } from '@/lib/api-server';
import { Sidebar } from './sidebar';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const identity = await getIdentity();
  if (!identity) redirect('/login');

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar identity={identity} />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
