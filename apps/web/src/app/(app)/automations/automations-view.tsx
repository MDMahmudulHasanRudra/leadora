'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, formatDateTime } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import { ACTION_LABELS, TRIGGER_LABELS } from '@/lib/automation';
import type { AutomationRule, AutomationRun } from '@/lib/types';

const RUN_TONE: Record<AutomationRun['status'], 'neutral' | 'green' | 'red' | 'brand'> = {
  QUEUED: 'neutral',
  RUNNING: 'brand',
  RETRYING: 'brand',
  SUCCEEDED: 'green',
  FAILED: 'red',
};
const STEP_MARK: Record<string, string> = { SUCCEEDED: '✓', SKIPPED: '–', FAILED: '✕' };

function RunRow({ run, canManage, timeZone, onRetry }: { run: AutomationRun; canManage: boolean; timeZone: string; onRetry: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="min-w-0 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="font-medium">{run.ruleName}</span>
          <span className="text-zinc-500">
            {' '}
            · v{run.ruleVersion} · {run.leadName ?? 'deleted lead'} · {run.steps.length}/{run.stepCount} steps
            {run.depth > 0 && ` · chained ×${run.depth}`}
          </span>
        </button>
        <span className="flex items-center gap-2">
          <Badge tone={RUN_TONE[run.status]}>{run.status.toLowerCase()}</Badge>
          <time className="text-xs text-zinc-500" dateTime={run.createdAt}>
            {formatDateTime(run.createdAt, timeZone)}
          </time>
          {canManage && run.status === 'FAILED' && (
            <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => onRetry(run.id)}>
              Retry
            </Button>
          )}
        </span>
      </div>
      {run.error && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{run.error}</p>}
      {open && (
        <ol className="mt-2 space-y-1 border-l-2 border-zinc-100 pl-3 text-xs dark:border-zinc-800">
          {run.steps.map((s) => (
            <li key={s.index}>
              <span className={s.status === 'FAILED' ? 'text-red-700 dark:text-red-400' : s.status === 'SKIPPED' ? 'text-zinc-500' : ''}>
                {STEP_MARK[s.status]} {ACTION_LABELS[s.type] ?? s.type}
              </span>
              {s.error && <span className="text-zinc-500"> — {s.error}</span>}
            </li>
          ))}
          {run.leadId && (
            <li>
              <Link href={`/leads/${run.leadId}`} className="text-brand-600 hover:underline">
                Open lead
              </Link>
            </li>
          )}
        </ol>
      )}
    </li>
  );
}

export function AutomationsView({
  rules,
  runs,
  tab,
  canManage,
  timeZone,
}: {
  rules: AutomationRule[];
  runs: AutomationRun[];
  tab: 'rules' | 'runs';
  canManage: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  const tabClass = (t: string) =>
    `border-b-2 px-1 pb-2 text-sm font-medium ${tab === t ? 'border-brand-600 text-brand-600 dark:text-white' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`;
  const failed = runs.filter((r) => r.status === 'FAILED').length;

  return (
    <div className="space-y-4">
      <nav className="flex gap-6 border-b border-zinc-200 dark:border-zinc-800" aria-label="Automation views">
        <Link href="/automations" className={tabClass('rules')} aria-current={tab === 'rules' ? 'page' : undefined}>
          Rules ({rules.length})
        </Link>
        <Link href="/automations?tab=runs" className={tabClass('runs')} aria-current={tab === 'runs' ? 'page' : undefined}>
          Run log{failed > 0 && <span className="ml-1 text-red-700 dark:text-red-400">· {failed} failed</span>}
        </Link>
      </nav>
      {error && <Alert>{error}</Alert>}

      {tab === 'rules' ? (
        <Card>
          {rules.length === 0 ? (
            <p className="p-8 text-center text-sm text-zinc-500">
              No automations yet.{canManage && ' Create one to assign, tag, follow up or notify automatically.'}
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/automations/${r.id}`} className="font-medium hover:text-brand-600 hover:underline">
                      {r.name}
                    </Link>
                    <p className="text-xs text-zinc-500">
                      {TRIGGER_LABELS[r.trigger] ?? r.trigger}
                      {r.trigger === 'lead.inactive' && ` (${r.triggerConfig.days ?? 7} days)`}
                      {r.conditions.length > 0 && ` · ${r.conditions.length} condition${r.conditions.length > 1 ? 's' : ''}`} → {r.actions.map((a) => ACTION_LABELS[a.type] ?? a.type).join(', ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    {r.stats && (
                      <span className="tabular-nums">
                        {r.stats.runs7d} runs / 7 days
                        {r.stats.failed7d > 0 && <span className="text-red-700 dark:text-red-400"> · {r.stats.failed7d} failed</span>}
                      </span>
                    )}
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        disabled={!canManage}
                        onChange={(e) => act(() => api(`/automations/${r.id}`, { method: 'PATCH', body: { enabled: e.target.checked } }))}
                        className="size-4 accent-brand-600"
                        aria-label={`${r.enabled ? 'Disable' : 'Enable'} ${r.name}`}
                      />
                      {r.enabled ? 'On' : 'Off'}
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <Card>
          {runs.length === 0 ? (
            <p className="p-8 text-center text-sm text-zinc-500">No runs yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} canManage={canManage} timeZone={timeZone} onRetry={(id) => act(() => api(`/automations/runs/${id}/retry`, { method: 'POST' }))} />
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
