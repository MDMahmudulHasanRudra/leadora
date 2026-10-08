'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, formatDateTime } from '@/components/ui';
import { ACTION_LABELS, explainAiError, titleCase as title } from '@/lib/ai';
import { api } from '@/lib/api-client';
import type { LeadAnalysis } from '@/lib/types';

export function LeadAiPanel({
  leadId,
  analysis,
  analyzedAt,
  canRun,
  canConfigure,
  timeZone,
}: {
  leadId: string;
  analysis: LeadAnalysis | null;
  analyzedAt: string | null;
  canRun: boolean;
  canConfigure: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsLink, setSettingsLink] = useState(false);

  async function analyze() {
    setBusy(true);
    setError(null);
    try {
      await api(`/ai/leads/${leadId}/analyze`, { method: 'POST' });
      router.refresh();
    } catch (err) {
      const e = explainAiError(err, canConfigure, 'Lead analysis');
      setError(e.message);
      setSettingsLink(e.settingsLink);
    } finally {
      setBusy(false);
    }
  }

  if (!analysis && !canRun) return null;

  return (
    <section aria-labelledby="ai-insight">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="ai-insight" className="text-sm font-medium text-zinc-500">
          AI insight
        </h2>
        {canRun && (
          <Button variant="secondary" className="h-8" disabled={busy} onClick={analyze}>
            {busy ? 'Analysing…' : analysis ? 'Re-analyse' : 'Analyse with AI'}
          </Button>
        )}
      </div>
      <Card className="p-5">
        {error && (
          <div className="mb-4">
            <Alert>
              {error}{' '}
              {settingsLink && (
                <Link href="/settings/ai" className="font-medium underline">
                  Open AI settings
                </Link>
              )}
            </Alert>
          </div>
        )}
        {!analysis ? (
          <p className="text-sm text-zinc-500">
            {busy ? 'Reading the profile, timeline and messages…' : 'No analysis yet. The AI reads this lead’s profile, timeline and messages, then scores it and suggests a next step.'}
          </p>
        ) : (
          <div className="grid gap-5 md:grid-cols-[auto_1fr]">
            <div className="flex items-center gap-4 md:flex-col md:items-start md:border-r md:border-zinc-100 md:pr-6 dark:md:border-zinc-800">
              <div>
                <p className="text-xs text-zinc-500">AI score</p>
                <p className="text-3xl font-semibold tabular-nums">
                  {analysis.score}
                  <span className="text-base font-normal text-zinc-400">/100</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Next step</p>
                <p className="font-medium">{ACTION_LABELS[analysis.recommendedAction] ?? analysis.recommendedAction}</p>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <p>{analysis.summary}</p>
              <div className="flex flex-wrap gap-2">
                <Badge tone="brand">Intent: {title(analysis.intent)}</Badge>
                <Badge>Buying signal: {title(analysis.buyingSignal)}</Badge>
                <Badge tone={analysis.urgency === 'HIGH' ? 'red' : 'neutral'}>Urgency: {title(analysis.urgency)}</Badge>
              </div>
              {(analysis.productInterest.length > 0 || analysis.objections.length > 0) && (
                <dl className="grid gap-3 sm:grid-cols-2">
                  {analysis.productInterest.length > 0 && (
                    <div>
                      <dt className="text-xs text-zinc-500">Interested in</dt>
                      <dd>{analysis.productInterest.join(', ')}</dd>
                    </div>
                  )}
                  {analysis.objections.length > 0 && (
                    <div>
                      <dt className="text-xs text-zinc-500">Objections</dt>
                      <dd>{analysis.objections.join(', ')}</dd>
                    </div>
                  )}
                </dl>
              )}
              <p className="text-xs text-zinc-500">
                Why: {analysis.rationale}
                {analyzedAt && <> · Analysed {formatDateTime(analyzedAt, timeZone)}</>} · AI suggestions can be wrong — use your judgement.
              </p>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
