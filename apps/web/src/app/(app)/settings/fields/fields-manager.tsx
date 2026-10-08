'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import type { CustomFieldDef, CustomFieldType } from '@/lib/types';

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Short text',
  long_text: 'Long text',
  number: 'Whole number',
  decimal: 'Decimal number',
  boolean: 'Yes / No',
  date: 'Date',
  datetime: 'Date and time',
  select: 'Single choice',
  multi_select: 'Multiple choice',
  url: 'Web link',
  email: 'Email',
  phone: 'Phone',
};
const isChoice = (t: string) => t === 'select' || t === 'multi_select';
const splitOptions = (raw: string) =>
  raw
    .split(/[\n,]/)
    .map((o) => o.trim())
    .filter(Boolean);

export function FieldsManager({ fields }: { fields: CustomFieldDef[] }) {
  const router = useRouter();
  const [type, setType] = useState<CustomFieldType>('text');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'NETWORK', 'Something went wrong'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const body: Record<string, unknown> = { label: data.get('label'), type, required: data.get('required') === 'on' };
    if (isChoice(type)) body.options = splitOptions(String(data.get('options') ?? ''));
    if (await run(() => api('/custom-fields', { method: 'POST', body }))) {
      form.reset();
      setType('text');
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert>{error.details[0]?.message ?? error.message}</Alert>}

      <Card className="p-5">
        <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
          <Field label="Field name" htmlFor="label">
            <Input id="label" name="label" required maxLength={80} placeholder="e.g. Budget range" />
          </Field>
          <Field label="Type" htmlFor="type">
            <Select id="type" value={type} onChange={(e) => setType(e.target.value as CustomFieldType)}>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          {isChoice(type) && (
            <div className="sm:col-span-2">
              <Field label="Choices" htmlFor="options" hint="One per line or separated by commas.">
                <textarea
                  id="options"
                  name="options"
                  rows={3}
                  required
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </Field>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="required" /> Required for new leads
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              Add field
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        {fields.length === 0 ? (
          <p className="p-10 text-center text-sm text-zinc-500">No custom fields yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {fields.map((f) =>
              editing === f.id ? (
                <li key={f.id} className="p-4">
                  <form
                    className="grid gap-3 sm:grid-cols-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      const body: Record<string, unknown> = { label: data.get('label'), required: data.get('required') === 'on' };
                      if (isChoice(f.type)) body.options = splitOptions(String(data.get('options') ?? ''));
                      if (await run(() => api(`/custom-fields/${f.id}`, { method: 'PATCH', body }))) setEditing(null);
                    }}
                  >
                    <Input name="label" defaultValue={f.label} aria-label="Field name" required maxLength={80} />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="required" defaultChecked={f.required} /> Required
                    </label>
                    {isChoice(f.type) && (
                      <textarea
                        name="options"
                        aria-label="Choices"
                        defaultValue={f.options?.join('\n')}
                        rows={3}
                        className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm sm:col-span-2 dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    )}
                    <div className="flex justify-end gap-2 sm:col-span-2">
                      <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={busy}>
                        Save
                      </Button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {f.label} {f.required && <Badge tone="brand">required</Badge>}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {TYPE_LABELS[f.type]}
                      {f.options?.length ? ` · ${f.options.join(', ')}` : ''} · <code>{f.key}</code>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" className="h-8" onClick={() => setEditing(f.id)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-8 text-red-600 dark:text-red-400"
                      disabled={busy}
                      onClick={() =>
                        confirm(`Remove "${f.label}"? Existing values are kept but hidden.`) &&
                        run(() => api(`/custom-fields/${f.id}`, { method: 'DELETE' }))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}
