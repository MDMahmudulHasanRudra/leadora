'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import type { AssignmentRule } from '@/lib/types';

const SOURCES = ['MANUAL', 'CSV', 'WEBSITE', 'API', 'WEBHOOK', 'FACEBOOK', 'INSTAGRAM', 'WHATSAPP', 'EMAIL', 'REFERRAL'];
const STRATEGY_LABEL = { USER: 'A specific person', ROUND_ROBIN: 'Take turns within a team', LEAST_LOADED: 'Team member with fewest open leads' };

const csv = (raw: FormDataEntryValue | null) =>
  String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function RulesManager({
  rules,
  users,
  teams,
}: {
  rules: AssignmentRule[];
  users: { id: string; fullName: string }[];
  teams: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [strategy, setStrategy] = useState<AssignmentRule['strategy']>('ROUND_ROBIN');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? (err.details[0]?.message ?? err.message) : 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const conditions: Record<string, string[]> = {};
    const sourceTypes = d.getAll('sourceTypes').map(String);
    if (sourceTypes.length) conditions.sourceTypes = sourceTypes;
    const countries = csv(d.get('countries')).map((c) => c.toUpperCase());
    if (countries.length) conditions.countries = countries;
    const tags = csv(d.get('tags'));
    if (tags.length) conditions.tags = tags;
    const body = {
      name: d.get('name'),
      strategy,
      conditions,
      ...(strategy === 'USER' ? { targetUserId: d.get('target') } : { targetTeamId: d.get('target') }),
    };
    if (await run(() => api('/assignment-rules', { method: 'POST', body }))) form.reset();
  }

  const describe = (r: AssignmentRule) => {
    const parts = [
      r.conditions.sourceTypes?.length && `source is ${r.conditions.sourceTypes.join(' or ')}`,
      r.conditions.countries?.length && `country is ${r.conditions.countries.join(' or ')}`,
      r.conditions.tags?.length && `tagged ${r.conditions.tags.join(' or ')}`,
      r.conditions.priorities?.length && `priority ${r.conditions.priorities.join(' or ')}`,
    ].filter(Boolean);
    const target =
      r.strategy === 'USER'
        ? (users.find((u) => u.id === r.targetUserId)?.fullName ?? 'a removed user')
        : `${teams.find((t) => t.id === r.targetTeamId)?.name ?? 'a removed team'} (${r.strategy === 'ROUND_ROBIN' ? 'taking turns' : 'least loaded'})`;
    return `${parts.length ? `When ${parts.join(' and ')}` : 'Any lead'} → ${target}`;
  };

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card>
        {rules.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">No rules yet. Imported leads go to whoever runs the import.</p>
        ) : (
          <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rules.map((r, i) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    <span className="text-zinc-400 tabular-nums">{i + 1}.</span> {r.name} {!r.enabled && <Badge>paused</Badge>}
                  </p>
                  <p className="text-xs text-zinc-500">{describe(r)}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    className="h-8"
                    disabled={busy}
                    onClick={() => run(() => api(`/assignment-rules/${r.id}`, { method: 'PATCH', body: { enabled: !r.enabled } }))}
                  >
                    {r.enabled ? 'Pause' : 'Resume'}
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 text-red-600 dark:text-red-400"
                    disabled={busy}
                    onClick={() => confirm(`Delete rule "${r.name}"?`) && run(() => api(`/assignment-rules/${r.id}`, { method: 'DELETE' }))}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-medium">Add a rule</h2>
        <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
          <Field label="Rule name" htmlFor="name">
            <Input id="name" name="name" required maxLength={100} placeholder="e.g. Website leads to Dhaka team" />
          </Field>
          <Field label="Give the lead to" htmlFor="strategy">
            <Select id="strategy" value={strategy} onChange={(e) => setStrategy(e.target.value as AssignmentRule['strategy'])}>
              {Object.entries(STRATEGY_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={strategy === 'USER' ? 'Person' : 'Team'} htmlFor="target">
            <Select id="target" name="target" required>
              {(strategy === 'USER' ? users.map((u) => [u.id, u.fullName]) : teams.map((t) => [t.id, t.name])).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Only for countries" htmlFor="countries" hint="Two-letter codes, comma-separated, e.g. BD, IN. Empty = any.">
            <Input id="countries" name="countries" />
          </Field>
          <Field label="Only with tags" htmlFor="tags" hint="Comma-separated. Empty = any.">
            <Input id="tags" name="tags" />
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">Only for sources (none checked = any)</legend>
            <div className="flex flex-wrap gap-3">
              {SOURCES.map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="sourceTypes" value={s} />
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={busy || (strategy !== 'USER' && teams.length === 0)}>
              Add rule
            </Button>
          </div>
          {strategy !== 'USER' && teams.length === 0 && (
            <p className="text-sm text-amber-700 sm:col-span-2 dark:text-amber-400">Create a team first under Teams.</p>
          )}
        </form>
      </Card>
    </div>
  );
}
