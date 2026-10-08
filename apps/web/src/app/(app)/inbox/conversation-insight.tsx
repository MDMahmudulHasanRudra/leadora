'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, formatDateTime } from '@/components/ui';
import { ACTION_LABELS, explainAiError, titleCase } from '@/lib/ai';
import { api } from '@/lib/api-client';
import type { ConversationAnalysis } from '@/lib/types';

function List({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-sm">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

/** Spec §31: structured result plus a human-readable summary, for the inbox context column. */
export function ConversationInsight({
  conversationId,
  analysis,
  analyzedAt,
  canRun,
  canConfigure,
  timeZone,
}: {
  conversationId: string;
  analysis: ConversationAnalysis | null;
  analyzedAt: string | null;
  canRun: boolean;
  canConfigure: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; settingsLink: boolean } | null>(null);

  async function analyze() {
    setBusy(true);
    setError(null);
    try {
      await api(`/ai/conversations/${conversationId}/analyze`, { method: 'POST' });
      router.refresh();
    } catch (err) {
      setError(explainAiError(err, canConfigure, 'Conversation analysis'));
    } finally {
      setBusy(false);
    }
  }

  if (!analysis && !canRun) return null;

  return (
    <section aria-labelledby="conv-ai" className="space-y-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <h2 id="conv-ai" className="text-xs font-medium text-zinc-500">
          AI insight
        </h2>
        {canRun && (
          <Button variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={analyze}>
            {busy ? 'Analysing…' : analysis ? 'Refresh' : 'Analyse'}
          </Button>
        )}
      </div>
      {error && (
        <Alert>
          {error.message}{' '}
          {error.settingsLink && (
            <Link href="/settings/ai" className="font-medium underline">
              Open AI settings
            </Link>
          )}
        </Alert>
      )}
      {!analysis ? (
        <p className="text-xs text-zinc-500">Summarise the thread and pull out questions, objections and risks.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">{analysis.summary}</p>
          <div className="flex flex-wrap gap-1">
            <Badge tone="brand">{titleCase(analysis.intent)}</Badge>
            <Badge tone={analysis.sentiment === 'NEGATIVE' ? 'red' : analysis.sentiment === 'POSITIVE' ? 'green' : 'neutral'}>
              {titleCase(analysis.sentiment)}
            </Badge>
            <Badge tone={analysis.urgency === 'HIGH' ? 'red' : 'neutral'}>{titleCase(analysis.urgency)} urgency</Badge>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Next step</p>
            <p className="text-sm font-medium">{ACTION_LABELS[analysis.recommendedNextAction] ?? analysis.recommendedNextAction}</p>
          </div>
          <List label="Open questions" items={analysis.questions} />
          <List label="Objections" items={analysis.objections} />
          <List label="Competitors mentioned" items={analysis.competitorMentions} />
          <List label="Risks" items={analysis.riskFlags} />
          {analyzedAt && <p className="text-[11px] text-zinc-500">Analysed {formatDateTime(analyzedAt, timeZone)} · AI can be wrong</p>}
        </div>
      )}
    </section>
  );
}
