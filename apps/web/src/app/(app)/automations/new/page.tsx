import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { loadEditorData } from '../editor-data';
import { RuleEditor } from '../rule-editor';

export const dynamic = 'force-dynamic';

export default async function NewAutomationPage() {
  const { meta, options } = await loadEditorData();
  return (
    <>
      <Link href="/automations" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← Automations
      </Link>
      <PageHeader title="New automation" />
      <RuleEditor meta={meta} options={options} />
    </>
  );
}