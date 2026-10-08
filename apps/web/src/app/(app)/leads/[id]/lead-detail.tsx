'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, formatDateTime, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import { formatCustomValue } from '@/components/custom-field-input';
import type { Activity, CustomFieldDef, Lead, Stage } from '@/lib/types';
import { LeadForm } from '../lead-form';
import { PriorityBadge, StageBadge } from '../lead-bits';

type Person = { id: string; fullName: string; active: boolean };

interface Props {
  lead: Lead;
  activities: Activity[];
  customFields: CustomFieldDef[];
  stages: Stage[];
  users: Person[];
  timeZone: string;
  can: { update: boolean; assign: boolean; archive: boolean };
}

const FIELD_LABELS: Record<string, string> = {
  fullName: 'name',
  companyName: 'company',
  jobTitle: 'job title',
  sourceId: 'source',
};

export function LeadDetail({ lead, activities, customFields, stages, users, timeZone, can }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
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
      default:
        return a.type;
    }
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

      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Timeline</h2>
        <Card>
          <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {activities.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm">
                <span>
                  <span className="font-medium">{a.actor?.fullName ?? 'System'}</span> {describe(a)}
                </span>
                <time className="text-xs text-zinc-500 tabular-nums" dateTime={a.createdAt}>
                  {formatDateTime(a.createdAt, timeZone)}
                </time>
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </div>
  );
}
