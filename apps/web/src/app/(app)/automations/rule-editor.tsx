'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Alert, Button, Card, Field, Input, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import { ACTION_LABELS, DEFAULT_PARAMS, needsValue, OP_LABELS, opsFor, TRIGGER_LABELS } from '@/lib/automation';
import type { AutomationAction, AutomationCondition, AutomationMeta, AutomationRule } from '@/lib/types';

interface Options {
  stages: { key: string; name: string }[];
  users: { id: string; fullName: string }[];
  inboxes: { id: string; name: string }[];
}

const textarea = 'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900';

function Row({ children, onRemove, label }: { children: ReactNode; onRemove: () => void; label: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">{children}</div>
      <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={onRemove} aria-label={`Remove ${label}`}>
        Remove
      </Button>
    </div>
  );
}

function ConditionValue({ field, op, value, onChange }: { field: AutomationMeta['conditionFields'][number] | undefined; op: string; value: unknown; onChange: (v: unknown) => void }) {
  if (!needsValue(op)) return <span />;
  const multi = op === 'in' || op === 'not_in';
  if (field?.type === 'enum' && field.options && !multi) {
    return (
      <Select aria-label="Value" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o.toLowerCase()}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <Input
      aria-label="Value"
      type={field?.type === 'number' && !multi ? 'number' : 'text'}
      value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
      placeholder={multi ? 'comma, separated, values' : ''}
      onChange={(e) =>
        onChange(multi ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : field?.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)
      }
    />
  );
}

function ActionParams({ action, options, onChange }: { action: AutomationAction; options: Options; onChange: (p: Record<string, unknown>) => void }) {
  const p = action.params;
  const set = (k: string, v: unknown) => onChange({ ...p, [k]: v });
  const userSelect = (k: string) => (
    <Select aria-label="User" value={String(p[k] ?? '')} onChange={(e) => set(k, e.target.value || undefined)}>
      <option value="">Choose a person…</option>
      {options.users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.fullName}
        </option>
      ))}
    </Select>
  );
  switch (action.type) {
    case 'assign_lead':
      return (
        <>
          <Select aria-label="Assign how" value={String(p.mode)} onChange={(e) => set('mode', e.target.value)}>
            <option value="rules">Using the assignment rules</option>
            <option value="user">To a specific person</option>
          </Select>
          {p.mode === 'user' && userSelect('userId')}
        </>
      );
    case 'change_stage':
      return (
        <Select aria-label="Stage" value={String(p.stageKey ?? '')} onChange={(e) => set('stageKey', e.target.value)}>
          <option value="">Choose a stage…</option>
          {options.stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </Select>
      );
    case 'change_priority':
      return (
        <Select aria-label="Priority" value={String(p.priority)} onChange={(e) => set('priority', e.target.value)}>
          {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((x) => (
            <option key={x} value={x}>
              {x.toLowerCase()}
            </option>
          ))}
        </Select>
      );
    case 'add_tag':
      return <Input aria-label="Tag" value={String(p.tag ?? '')} maxLength={50} placeholder="Tag name" onChange={(e) => set('tag', e.target.value)} />;
    case 'create_followup':
      return (
        <>
          <Select aria-label="Follow-up type" value={String(p.type)} onChange={(e) => set('type', e.target.value)}>
            {['CALL', 'EMAIL', 'MESSAGE', 'MEETING', 'CUSTOM'].map((x) => (
              <option key={x} value={x}>
                {x.toLowerCase()}
              </option>
            ))}
          </Select>
          <Input aria-label="In hours" type="number" min={0} step="0.5" value={String(p.inHours ?? 1)} onChange={(e) => set('inHours', Number(e.target.value))} />
          <Select aria-label="Assign to" value={String(p.assignTo ?? 'owner')} onChange={(e) => set('assignTo', e.target.value)}>
            <option value="owner">The lead’s owner</option>
            <option value="user">A specific person</option>
          </Select>
          {p.assignTo === 'user' && userSelect('userId')}
          <Input aria-label="Notes" className="sm:col-span-3" value={String(p.notes ?? '')} placeholder="Notes, e.g. Call {{lead.firstName}} about pricing" onChange={(e) => set('notes', e.target.value)} />
        </>
      );
    case 'send_notification':
      return (
        <>
          <Select aria-label="Notify" value={String(p.to)} onChange={(e) => set('to', e.target.value)}>
            <option value="owner">The lead’s owner</option>
            <option value="managers">All admins and managers</option>
            <option value="user">A specific person</option>
          </Select>
          {p.to === 'user' && userSelect('userId')}
          <Input aria-label="Title" className="sm:col-span-3" maxLength={200} value={String(p.title ?? '')} onChange={(e) => set('title', e.target.value)} />
          <Input aria-label="Message" className="sm:col-span-3" maxLength={1000} value={String(p.body ?? '')} placeholder="Optional details" onChange={(e) => set('body', e.target.value)} />
        </>
      );
    case 'send_email':
      return (
        <>
          <Select aria-label="From inbox" value={String(p.inboxId ?? '')} onChange={(e) => set('inboxId', e.target.value)}>
            <option value="">Send from…</option>
            {options.inboxes.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
          <Input aria-label="Subject" className="sm:col-span-2" maxLength={300} value={String(p.subject ?? '')} placeholder="Subject" onChange={(e) => set('subject', e.target.value)} />
          <textarea aria-label="Email body" rows={4} className={`${textarea} sm:col-span-3`} value={String(p.body ?? '')} onChange={(e) => set('body', e.target.value)} />
        </>
      );
    case 'draft_ai_reply':
      return (
        <Select aria-label="Language" value={String(p.language ?? 'en')} onChange={(e) => set('language', e.target.value)}>
          <option value="en">English</option>
          <option value="bn">Bangla</option>
        </Select>
      );
    default:
      return <span className="text-xs text-zinc-500 sm:col-span-2">No settings needed.</span>;
  }
}

export function RuleEditor({ meta, options, rule }: { meta: AutomationMeta; options: Options; rule?: AutomationRule }) {
  const router = useRouter();
  const [name, setName] = useState(rule?.name ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [trigger, setTrigger] = useState(rule?.trigger ?? 'lead.created');
  const [days, setDays] = useState(rule?.triggerConfig.days ?? 7);
  const [conditions, setConditions] = useState<AutomationCondition[]>(rule?.conditions ?? []);
  const [actions, setActions] = useState<AutomationAction[]>(rule?.actions ?? [{ type: 'send_notification', params: { ...DEFAULT_PARAMS.send_notification } }]);
  const [cooldown, setCooldown] = useState(rule?.cooldownMinutes ?? 0);
  const [priority, setPriority] = useState(rule?.priority ?? 100);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fieldOf = (key: string) => meta.conditionFields.find((f) => f.key === key);
  const updateCondition = (i: number, patch: Partial<AutomationCondition>) => setConditions((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const updateAction = (i: number, a: AutomationAction) => setActions((as) => as.map((x, j) => (j === i ? a : x)));
  const move = (i: number, d: -1 | 1) =>
    setActions((as) => {
      const next = [...as];
      const [item] = next.splice(i, 1);
      next.splice(i + d, 0, item!);
      return next;
    });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name,
      description: description || null,
      enabled,
      trigger,
      triggerConfig: trigger === 'lead.inactive' ? { days } : {},
      conditions: conditions.map((c) => (needsValue(c.op) ? c : { field: c.field, op: c.op })),
      actions,
      priority,
      cooldownMinutes: cooldown,
    };
    try {
      await api(rule ? `/automations/${rule.id}` : '/automations', { method: rule ? 'PUT' : 'POST', body });
      router.push('/automations');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? (err.details[0] ? `${err.details[0].path}: ${err.details[0].message}` : err.message) : 'Could not save');
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!rule || !confirm(`Delete “${rule.name}”? Its run history is deleted too.`)) return;
    await api(`/automations/${rule.id}`, { method: 'DELETE' });
    router.push('/automations');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Name" htmlFor="name">
          <Input id="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hot website leads go to Rahim" />
        </Field>
        <Field label="Description" htmlFor="desc">
          <Input id="desc" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-medium">When</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} className="w-auto">
            {meta.triggers.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABELS[t] ?? t}
              </option>
            ))}
          </Select>
          {trigger === 'lead.inactive' && (
            <label className="flex items-center gap-2 text-sm">
              for
              <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-20" aria-label="Days" />
              days
            </label>
          )}
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Only if {conditions.length > 1 && <span className="text-sm font-normal text-zinc-500">(all must be true)</span>}</h2>
          <Button type="button" variant="secondary" className="h-8" onClick={() => setConditions((cs) => [...cs, { field: 'lead.temperature', op: 'eq', value: 'HOT' }])}>
            Add condition
          </Button>
        </div>
        {conditions.length === 0 && <p className="text-sm text-zinc-500">Always — no conditions.</p>}
        {conditions.map((c, i) => {
          const f = fieldOf(c.field);
          return (
            <Row key={i} label="condition" onRemove={() => setConditions((cs) => cs.filter((_, j) => j !== i))}>
              <Select aria-label="Field" value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value, op: opsFor(fieldOf(e.target.value)?.type ?? 'text')[0]!, value: undefined })}>
                {meta.conditionFields.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </Select>
              <Select aria-label="Operator" value={c.op} onChange={(e) => updateCondition(i, { op: e.target.value })}>
                {opsFor(f?.type ?? 'text').map((o) => (
                  <option key={o} value={o}>
                    {OP_LABELS[o] ?? o}
                  </option>
                ))}
              </Select>
              <ConditionValue field={f} op={c.op} value={c.value} onChange={(v) => updateCondition(i, { value: v })} />
            </Row>
          );
        })}
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Then, in order</h2>
          <Select
            aria-label="Add action"
            value=""
            onChange={(e) => e.target.value && setActions((as) => [...as, { type: e.target.value, params: { ...(DEFAULT_PARAMS[e.target.value] ?? {}) } }])}
            className="w-auto"
          >
            <option value="">Add action…</option>
            {meta.actions.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a] ?? a}
              </option>
            ))}
          </Select>
        </div>
        {actions.map((a, i) => (
          <div key={i} className="space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {i + 1}. {ACTION_LABELS[a.type] ?? a.type}
              </span>
              <span className="flex gap-1">
                <Button type="button" variant="ghost" className="h-6 px-1.5 text-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  ↑
                </Button>
                <Button type="button" variant="ghost" className="h-6 px-1.5 text-xs" disabled={i === actions.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                  ↓
                </Button>
              </span>
            </div>
            <Row label="action" onRemove={() => setActions((as) => as.filter((_, j) => j !== i))}>
              <ActionParams action={a} options={options} onChange={(params) => updateAction(i, { ...a, params })} />
            </Row>
          </div>
        ))}
        <p className="text-xs text-zinc-500">
          Text can use <code>{'{{lead.fullName}}'}</code>, <code>{'{{lead.firstName}}'}</code>, <code>{'{{lead.score}}'}</code>, <code>{'{{lead.stage}}'}</code>, <code>{'{{lead.owner}}'}</code>. AI
          replies are saved as internal notes for a person to review — never sent automatically.
        </p>
      </Card>

      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        <Field label="Don’t repeat for the same lead within (minutes)" htmlFor="cooldown" hint="0 = no limit">
          <Input id="cooldown" type="number" min={0} max={43200} value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} />
        </Field>
        <Field label="Order" htmlFor="priority" hint="Lower runs first when several rules match">
          <Input id="priority" type="number" min={0} max={1000} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 accent-brand-600" /> Enabled
        </label>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <div>
          {rule && (
            <Button type="button" variant="danger" onClick={onDelete}>
              Delete
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => router.push('/automations')}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {rule ? `Save as version ${rule.version + 1}` : 'Create automation'}
          </Button>
        </div>
      </div>
    </form>
  );
}
