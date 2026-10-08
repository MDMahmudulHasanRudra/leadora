import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { apiGet } from '@/lib/api-server';
import type { AutomationRule } from '@/lib/types';
import { loadEditorData } from '../editor-data';
import { RuleEditor } from '../rule-editor';

export const dynamic = 'force-dynamic';

export default async function EditAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ meta, options }, rule] = await Promise.all([loadEditorData(), apiGet<AutomationRule>(`/automations/${encodeURIComponent(id)}`)]);
  if (!rule.data) notFound();
  return (
    <>
      <Link href="/automations" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← Automations
      </Link>
      <PageHeader title={rule.data.name} description={`Version ${rule.data.version}. Saving creates a new version; past runs keep the version they used.`} />
      <RuleEditor meta={meta} options={options} rule={rule.data} />
    </>
  );
}