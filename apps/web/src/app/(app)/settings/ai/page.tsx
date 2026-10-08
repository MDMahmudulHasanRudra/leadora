import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import type { AiSettings, AiUsage, PromptInfo } from '@/lib/types';
import { AiSettingsForm } from './ai-settings-form';
import { AiUsagePanel } from './ai-usage-panel';
import { PromptsManager } from './prompts-manager';

export const dynamic = 'force-dynamic';

export default async function AiSettingsPage() {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('ai.configure')) redirect('/');
  const [settings, prompts, usage] = await Promise.all([
    requireData<AiSettings>('/ai/settings'),
    requireData<{ items: PromptInfo[] }>('/ai/prompts'),
    identity.permissions.includes('analytics.view') ? requireData<AiUsage>('/ai/usage') : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader title="AI" description="Provider, models, spending limits and prompts. AI is optional — the CRM works without it." />
      <div className="space-y-8">
        <AiSettingsForm settings={settings} />
        {usage && <AiUsagePanel usage={usage} budget={settings.monthlyBudgetUsd} />}
        <PromptsManager prompts={prompts.items} />
      </div>
    </>
  );
}
