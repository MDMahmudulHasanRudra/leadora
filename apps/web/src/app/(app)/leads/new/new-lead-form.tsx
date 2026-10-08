'use client';

import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import type { CustomFieldDef, Lead, Stage } from '@/lib/types';
import { LeadForm } from '../lead-form';

export function NewLeadForm({
  stages,
  owners,
  customFields,
}: {
  stages: Stage[];
  owners?: { id: string; fullName: string }[];
  customFields: CustomFieldDef[];
}) {
  const router = useRouter();
  return (
    <LeadForm
      stages={stages.filter((s) => s.outcome === 'OPEN')}
      owners={owners}
      customFields={customFields}
      submitLabel="Create lead"
      onCancel={() => router.push('/leads')}
      onSubmit={async (body) => {
        const lead = await api<Lead>('/leads', { method: 'POST', body });
        router.push(`/leads/${lead.id}`);
      }}
    />
  );
}
