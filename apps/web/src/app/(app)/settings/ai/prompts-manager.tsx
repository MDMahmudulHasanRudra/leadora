'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import { MODEL_PROFILES, type PromptInfo } from '@/lib/types';

function PromptCard({ prompt }: { prompt: PromptInfo }) {
  const router = useRouter();
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = prompt.versions.find((v) => v.active) ?? prompt.builtin;

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
    const data = new FormData(e.currentTarget);
    const ok = await run(() =>
      api(`/ai/prompts/${prompt.key}/versions`, {
        method: 'POST',
        body: {
          systemPrompt: data.get('systemPrompt'),
          modelProfile: data.get('modelProfile'),
          maxOutputTokens: Number(data.get('maxOutputTokens')),
          notes: String(data.get('notes') ?? '').trim() || undefined,
        },
      }),
    );
    if (ok) setDrafting(false);
  }

  const rows = [{ ...prompt.builtin, label: 'Built-in', notes: null as string | null }, ...prompt.versions.map((v) => ({ ...v, label: `Version ${v.version}` }))];

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 p-4 dark:border-zinc-800">
        <div>
          <p className="font-mono text-sm font-medium">{prompt.key}</p>
          <p className="text-sm text-zinc-500">{prompt.description}</p>
        </div>
        {!drafting && (
          <Button variant="secondary" onClick={() => setDrafting(true)}>
            New version
          </Button>
        )}
      </div>
      {error && (
        <div className="p-4 pb-0">
          <Alert>{error}</Alert>
        </div>
      )}
      {drafting && (
        <form onSubmit={onCreate} className="grid gap-4 border-b border-zinc-100 p-4 sm:grid-cols-3 dark:border-zinc-800">
          <div className="sm:col-span-3">
            <Field label="System prompt" htmlFor={`sp-${prompt.key}`} hint="Starts from the active version. The output schema is enforced separately, so edits can’t break parsing.">
              <textarea
                id={`sp-${prompt.key}`}
                name="systemPrompt"
                required
                minLength={20}
                maxLength={20000}
                rows={10}
                defaultValue={active.systemPrompt}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
            </Field>
          </div>
          <Field label="Model profile" htmlFor={`mp-${prompt.key}`}>
            <Select id={`mp-${prompt.key}`} name="modelProfile" defaultValue={active.modelProfile}>
              {MODEL_PROFILES.filter((p) => p !== 'embedding').map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Max output tokens" htmlFor={`mt-${prompt.key}`}>
            <Input id={`mt-${prompt.key}`} name="maxOutputTokens" type="number" min={50} max={16000} required defaultValue={active.maxOutputTokens} />
          </Field>
          <Field label="Notes" htmlFor={`nt-${prompt.key}`}>
            <Input id={`nt-${prompt.key}`} name="notes" maxLength={1000} placeholder="What changed and why" />
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-3">
            <Button type="button" variant="secondary" onClick={() => setDrafting(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Save as draft
            </Button>
          </div>
        </form>
      )}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {rows.map((v) => {
          const isActive = v.version === prompt.activeVersion;
          return (
            <li key={v.version} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  {v.label} {isActive && <Badge tone="green">Active</Badge>}
                </p>
                <p className="text-xs text-zinc-500">
                  {v.modelProfile} · up to {v.maxOutputTokens} tokens{v.notes ? ` · ${v.notes}` : ''}
                </p>
              </div>
              {!isActive && (
                <Button variant="ghost" disabled={busy} onClick={() => run(() => api(`/ai/prompts/${prompt.key}/versions/${v.version}/activate`, { method: 'POST' }))}>
                  {v.version === 0 ? 'Revert to built-in' : 'Activate'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function PromptsManager({ prompts }: { prompts: PromptInfo[] }) {
  return (
    <section aria-labelledby="ai-prompts" className="space-y-3">
      <div>
        <h2 id="ai-prompts" className="font-medium">
          Prompts
        </h2>
        <p className="text-sm text-zinc-500">New versions are drafts until you activate them, and every AI run records the version it used.</p>
      </div>
      {prompts.map((p) => (
        <PromptCard key={p.key} prompt={p} />
      ))}
    </section>
  );
}
