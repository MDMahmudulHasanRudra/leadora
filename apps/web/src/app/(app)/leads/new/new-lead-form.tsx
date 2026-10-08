'use client';

import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import type { Lead, Stage } from '@/lib/types';
import { LeadForm } from '../lead-form';

export function NewLeadForm({ stages, owners }: { stages: Stage[]; owners?: { id: string; fullName: string }[] }) {
  const router = useRouter();
  return (
    <LeadForm
      stages={stages.filter((s) => s.outcome === 'OPEN')}
      owners={owners}
      submitLabel="Create lead"
      onCancel={() => router.push('/leads')}
      onSubmit={async (body) => {
        const lead = await api<Lead>('/leads', { method: 'POST', body });
        router.push(`/leads/${lead.id}`);
      }}
    />
  );
}
