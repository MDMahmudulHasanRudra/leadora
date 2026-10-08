import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import type { ScoringSettings } from '@/lib/types';
import { ScoringForm } from './scoring-form';

export const dynamic = 'force-dynamic';

export default async function ScoringPage() {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('settings.manage')) redirect('/');
  const settings = await requireData<ScoringSettings>('/scoring/settings');
  return (
    <>
      <PageHeader
        title="Lead scoring"
        description="Every lead gets a 0–100 score from simple rules, blended with the AI’s assessment when a lead has been analysed."
      />
      <ScoringForm settings={settings} />
    </>
  );
}
