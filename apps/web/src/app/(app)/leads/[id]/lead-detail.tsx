'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { FollowupList } from '@/components/followup-list';
import { TaskList } from '@/components/task-list';
import { Alert, Button, Card, formatDateTime, Input, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import { RULE_SHORT_LABELS, temperatureLabel } from '@/lib/scoring';
import { formatCustomValue } from '@/components/custom-field-input';
import { type Activity, type CustomFieldDef, FOLLOWUP_TYPES, type Followup, type Lead, type LeadAnalysis, type Stage, type Task } from '@/lib/types';
import { NewTaskForm } from '../../tasks/new-task-form';
import { LeadForm } from '../lead-form';
import { PriorityBadge, StageBadge } from '../lead-bits';
import { ACTION_LABELS } from '@/lib/ai';
import { LeadAiPanel } from './lead-ai-panel';

type Person = { id: string; fullName: string; active: boolean };

/** Spec §14: the score is explainable — show what produced it. */
function ScoreSummary({ lead }: { lead: Lead }) {
  const b = lead.scoreBreakdown;
  const blended = b && b.aiScore !== null && b.aiWeight > 0;
  return (
    <div>
      <p className="text-xs text-zinc-500">Score</p>
      <p className="mt-0.5 text-sm">
        <span className="text-lg font-semibold tabular-nums">{lead.score}</span>
        <span className="text-zinc-400">/100</span> {lead.temperature && <span className="font-medium">· {temperatureLabel(lead.temperature)}</span>}
      </p>
      {b && (
        <details className="mt-1 text-xs text-zinc-500">
          <summary className="cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200">Why this score</summary>
          <ul className="mt-1.5 space-y-0.5">
            {b.rules.length === 0 && <li>No rule signals yet</li>}
            {b.rules.map((r) => (
              <li key={r.key} className="flex justify-between gap-2">
                <span>{RULE_SHORT_LABELS[r.key] ?? r.key}</span>
                <span className="tabular-nums">{r.points > 0 ? `+${r.points}` : r.points}</span>
              </li>
            ))}
            <li className="flex justify-between gap-2 border-t border-zinc-100 pt-0.5 font-medium dark:border-zinc-800">
              <span>Rule score</span>
              <span className="tabular-nums">{b.ruleScore}</span>
            </li>
            {blended && (
              <li className="pt-1">
                Blended with AI score {b.aiScore} ({b.ruleWeight}% rules · {b.aiWeight}% AI)
              </li>
            )}
          </ul>
        </details>
      )}
    </div>
  );
}

interface Props {
  lead: Lead;
  activities: Activity[];
  followups: Followup[];
  tasks: Task[];
  customFields: CustomFieldDef[];
  stages: Stage[];
  users: Person[];
  timeZone: string;
  can: { update: boolean; assign: boolean; archive: boolean; followup: boolean; message: boolean; ai: boolean; aiConfigure: boolean };
  analysis: { result: LeadAnalysis; createdAt: string } | null;
  inboxes: { id: string; name: string; channel: string }[];
}

const FIELD_LABELS: Record<string, string> = {
  fullName: 'name',
  companyName: 'company',
  jobTitle: 'job title',
  sourceId: 'source',
};

export function LeadDetail({ lead, activities, followups, tasks, customFields, stages, users, timeZone, can, inboxes, analysis }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const archived = !!lead.archivedAt;

  const userName = (id: unknown) => (id ? (users.find((u) => u.id === id)?.fullName ?? 'a teammate') : 'nobody');
  const stageName = (key: unknown) => stages.find((s) => s.key === key)?.name ?? String(key);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const patch = (body: object) => run(() => api(`/leads/${lead.id}`, { method: 'PATCH', body }));

  function describe(a: Activity): string {
    const p = a.payload ?? {};
    switch (a.type) {
      case 'lead.created':
        return 'added this lead';
      case 'lead.assigned':
        return p.to ? `assigned it to ${userName(p.to)}` : 'unassigned it';
      case 'lead.stage_changed':
        return `moved it from ${stageName(p.from)} to ${stageName(p.to)}`;
      case 'lead.updated': {
        const changes = (p.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
        return `updated ${Object.keys(changes)
          .map((k) => FIELD_LABELS[k] ?? customFields.find((d) => `customFields.${d.key}` === k)?.label ?? k)
          .join(', ')}`;
      }
      case 'lead.archived':
        return 'archived it';
      case 'lead.restored':
        return 'restored it';
      case 'lead.converted':
        return p.mergedContact ? 'converted it, merging into an existing contact' : 'converted it to a contact';
      case 'note.added':
        return 'added a note';
      case 'ai.conversation_analyzed':
        return `ran an AI analysis of a conversation: AI score ${p.score}, ${String(p.sentiment ?? '').toLowerCase()} sentiment`;
      case 'ai.analysis_completed':
        return `ran an AI analysis: AI score ${p.score}${p.recommendedAction ? `, suggested “${ACTION_LABELS[String(p.recommendedAction)] ?? p.recommendedAction}”` : ''}`;
      case 'followup.created':
        return `scheduled a ${String(p.type).toLowerCase()} for ${formatDateTime(String(p.scheduledAt), timeZone)}`;
      case 'followup.completed':
        return `completed a ${String(p.type).toLowerCase()}${p.outcome ? `: ${p.outcome}` : ''}`;
      case 'followup.skipped':
        return `skipped a ${String(p.type).toLowerCase()}`;
      case 'followup.cancelled':
        return `cancelled a ${String(p.type).toLowerCase()}`;
      case 'followup.rescheduled':
        return `rescheduled a ${String(p.type).toLowerCase()} to ${formatDateTime(String(p.to), timeZone)}`;
      default:
        return a.type;
    }
  }

  async function startConversation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ conversation: { id: string } }>('/conversations', {
        method: 'POST',
        body: { inboxId: data.get('inboxId'), leadId: lead.id, subject: data.get('subject') || undefined, body: data.get('body') },
      });
      router.push(`/inbox?c=${res.conversation.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the message');
      setBusy(false);
    }
  }

  async function addNote(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get('note') ?? '').trim();
    if (!body) return;
    await run(() => api(`/leads/${lead.id}/notes`, { method: 'POST', body: { body } }));
    form.reset();
  }

  async function scheduleFollowup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const when = String(data.get('when') ?? '');
    if (!when) return;
    await run(() =>
      api(`/leads/${lead.id}/followups`, {
        method: 'POST',
        body: { type: data.get('type'), scheduledAt: new Date(when).toISOString(), notes: String(data.get('fnotes') ?? '') || undefined },
      }),
    );
    form.reset();
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/leads" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          ← Leads
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{lead.fullName}</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {[lead.jobTitle, lead.companyName].filter(Boolean).join(' at ') || 'No company yet'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StageBadge stage={lead.stage} />
              <PriorityBadge priority={lead.priority} />
              {archived && <span className="text-xs font-medium text-red-600">Archived</span>}
            </div>
          </div>
          <div className="flex gap-2">
            {can.message && !archived && inboxes.length > 0 && (
              <Button variant="secondary" onClick={() => setComposing((v) => !v)}>
                Message
              </Button>
            )}
            {lead.contactId ? (
              <Link
                href={`/contacts/${lead.contactId}`}
                className="inline-flex h-9 items-center rounded-md border border-zinc-300 px-3.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                View contact
              </Link>
            ) : (
              can.update &&
              !archived && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    confirm(`Convert ${lead.fullName} into a contact${lead.companyName ? ` at ${lead.companyName}` : ''}?`) &&
                    run(() => api(`/leads/${lead.id}/convert`, { method: 'POST' }))
                  }
                >
                  Convert
                </Button>
              )
            )}
            {can.update && !archived && !editing && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {can.archive && (
              <Button
                variant={archived ? 'secondary' : 'danger'}
                disabled={busy}
                onClick={() =>
                  archived
                    ? run(() => api(`/leads/${lead.id}/restore`, { method: 'POST' }))
                    : confirm(`Archive ${lead.fullName}? You can restore it later.`) &&
                      run(() => api(`/leads/${lead.id}`, { method: 'DELETE' }))
                }
              >
                {archived ? 'Restore' : 'Archive'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {composing && (
        <Card className="p-5">
          <form onSubmit={startConversation} className="grid gap-3 sm:grid-cols-2">
            <Select name="inboxId" aria-label="Send from" required>
              {inboxes.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.channel.toLowerCase()})
                </option>
              ))}
            </Select>
            <Input name="subject" placeholder="Subject" aria-label="Subject" maxLength={300} />
            <textarea
              name="body"
              required
              rows={4}
              maxLength={20000}
              aria-label="Message"
              placeholder={`Write to ${lead.fullName}…`}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm sm:col-span-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="secondary" onClick={() => setComposing(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Send
              </Button>
            </div>
          </form>
        </Card>
      )}

      {editing ? (
        <Card className="p-5">
          <LeadForm
            initial={lead}
            customFields={customFields}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              await api(`/leads/${lead.id}`, { method: 'PATCH', body });
              setEditing(false);
              router.refresh();
            }}
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              {[
                ['Email', lead.email ? <a href={`mailto:${lead.email}`} className="text-brand-600 hover:underline">{lead.email}</a> : null],
                ['Phone', lead.phone ? <a href={`tel:${lead.phone}`} className="text-brand-600 hover:underline">{lead.phone}</a> : null],
                ['Location', lead.location],
                ['Industry', lead.industry],
                ['Source', lead.source.name],
                ['Added', formatDateTime(lead.createdAt, timeZone)],
                ...customFields.map((def) => [def.label, formatCustomValue(def, lead.customFields[def.key])]),
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs text-zinc-500">{label}</dt>
                  <dd className="mt-0.5">{value || <span className="text-zinc-400">—</span>}</dd>
                </div>
              ))}
              <div className="sm:col-span-2">
                <dt className="text-xs text-zinc-500">Tags</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {lead.tags.length ? (
                    lead.tags.map((t) => (
                      <span key={t} className="rounded bg-zinc-100 px-1.5 text-xs dark:bg-zinc-800">
                        {t}
                      </span>
                    ))
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </dd>
              </div>
              {lead.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-zinc-500">Notes</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap">{lead.notes}</dd>
                </div>
              )}
            </dl>
          </Card>

          <Card className="space-y-4 p-5">
            {lead.score !== null && <ScoreSummary lead={lead} />}
            <div>
              <label htmlFor="stage" className="text-xs text-zinc-500">
                Stage
              </label>
              <Select
                id="stage"
                value={lead.stage.id}
                disabled={!can.update || archived || busy}
                onChange={(e) => patch({ stageId: e.target.value })}
                className="mt-1"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="owner" className="text-xs text-zinc-500">
                Owner
              </label>
              {can.assign && !archived ? (
                <Select
                  id="owner"
                  value={lead.owner?.id ?? ''}
                  disabled={busy}
                  onChange={(e) => patch({ ownerUserId: e.target.value || null })}
                  className="mt-1"
                >
                  <option value="">Unassigned</option>
                  {users
                    .filter((u) => u.active || u.id === lead.owner?.id)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName}
                      </option>
                    ))}
                </Select>
              ) : (
                <p className="mt-1 text-sm">{lead.owner?.fullName ?? 'Unassigned'}</p>
              )}
            </div>
          </Card>
        </div>
      )}

      <LeadAiPanel
        leadId={lead.id}
        analysis={analysis?.result ?? null}
        analyzedAt={analysis?.createdAt ?? null}
        canRun={can.ai && !archived}
        canConfigure={can.aiConfigure}
        canSchedule={can.followup && !archived}
        timeZone={timeZone}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-medium text-zinc-500">Follow-ups</h2>
          <Card>
            {can.followup && !archived && (
              <form onSubmit={scheduleFollowup} className="flex flex-wrap gap-2 border-b border-zinc-100 p-3 dark:border-zinc-800">
                <Select name="type" aria-label="Follow-up type" className="h-8 w-auto">
                  {FOLLOWUP_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0) + t.slice(1).toLowerCase()}
                    </option>
                  ))}
                </Select>
                <Input name="when" type="datetime-local" required aria-label="When" className="h-8 w-auto" />
                <Input name="fnotes" placeholder="Note (optional)" aria-label="Follow-up note" maxLength={2000} className="h-8 min-w-32 flex-1" />
                <Button type="submit" className="h-8" disabled={busy}>
                  Schedule
                </Button>
              </form>
            )}
            <FollowupList items={followups} timeZone={timeZone} showLead={false} />
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium text-zinc-500">Tasks</h2>
          <Card>
            {can.followup && !archived && (
              <div className="border-b border-zinc-100 p-3 dark:border-zinc-800">
                <NewTaskForm leadId={lead.id} />
              </div>
            )}
            <TaskList items={tasks} timeZone={timeZone} showLead={false} />
          </Card>
        </section>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Timeline</h2>
        <Card>
          {can.update && !archived && (
            <form onSubmit={addNote} className="flex gap-2 border-b border-zinc-100 p-3 dark:border-zinc-800">
              <textarea
                name="note"
                rows={2}
                maxLength={5000}
                placeholder="Add a note — what happened, what was agreed…"
                aria-label="New note"
                className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <Button type="submit" disabled={busy} className="self-end">
                Add note
              </Button>
            </form>
          )}
          <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {activities.map((a) => (
              <li key={a.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>
                    <span className="font-medium">{a.actor?.fullName ?? 'System'}</span> {describe(a)}
                  </span>
                  <time className="text-xs text-zinc-500 tabular-nums" dateTime={a.createdAt}>
                    {formatDateTime(a.createdAt, timeZone)}
                  </time>
                </div>
                {a.type === 'note.added' && (
                  <p className="mt-1 rounded-md bg-amber-50 px-3 py-2 whitespace-pre-wrap text-zinc-800 dark:bg-amber-950/40 dark:text-zinc-200">
                    {String(a.payload?.body ?? '')}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </div>
  );
}
