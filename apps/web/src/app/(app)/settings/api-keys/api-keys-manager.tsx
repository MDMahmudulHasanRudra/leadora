'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Alert, Badge, Button, Card, Field, formatDateTime, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const SCOPE_HELP: Record<string, string> = {
  'leads:read': 'Read leads',
  'leads:write': 'Create and update leads',
  'conversations:read': 'Read conversations',
  'followups:read': 'Read follow-ups',
  'followups:write': 'Create and complete follow-ups',
  'analytics:read': 'Read dashboards',
};

function status(k: ApiKeyRow): { label: string; tone: 'green' | 'red' | 'neutral' } {
  if (k.revokedAt) return { label: 'revoked', tone: 'red' };
  if (k.expiresAt && new Date(k.expiresAt).getTime() <= Date.now()) return { label: 'expired', tone: 'neutral' };
  return { label: 'active', tone: 'green' };
}

export function ApiKeysManager({ keys, scopes, timeZone }: { keys: ApiKeyRow[]; scopes: string[]; timeZone: string }) {
  const router = useRouter();
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const expires = String(d.get('expires') ?? '');
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ key: string }>('/api-keys', {
        method: 'POST',
        body: { name: d.get('name'), scopes: d.getAll('scopes'), ...(expires ? { expiresAt: new Date(`${expires}T23:59:59`).toISOString() } : {}) },
      });
      setCreated(res.key);
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? (err.details[0]?.message ?? err.message) : 'Could not create the key');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(k: ApiKeyRow) {
    if (!confirm(`Revoke “${k.name}”? Anything using it stops working immediately.`)) return;
    await api(`/api-keys/${k.id}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {created && (
        <Card className="space-y-3 border-amber-300 p-5 dark:border-amber-800">
          <p className="font-medium">Copy the key now — it won’t be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="font-mono text-xs break-all">{created}</code>
            <Button variant="ghost" className="h-7" onClick={() => navigator.clipboard.writeText(created)}>
              Copy
            </Button>
          </div>
          <p className="text-xs text-zinc-500">
            Send it as <code>Authorization: Bearer &lt;key&gt;</code>, e.g. <code>GET /api/v1/leads</code>. Keep it on your server — never in a browser or app.
          </p>
          <Button variant="secondary" onClick={() => setCreated(null)}>
            I’ve saved it
          </Button>
        </Card>
      )}
      <Card>
        {keys.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">No API keys yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {keys.map((k) => {
              const s = status(k);
              return (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {k.name} <span className="font-mono text-xs font-normal text-zinc-500">{k.prefix}…</span>
                    </p>
                    <p className="text-xs text-zinc-500">
                      {k.scopes.join(', ')} · last used {k.lastUsedAt ? formatDateTime(k.lastUsedAt, timeZone) : 'never'}
                      {k.expiresAt && ` · expires ${formatDateTime(k.expiresAt, timeZone)}`}
                    </p>
                  </div>
                  <span className="flex items-center gap-2">
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {!k.revokedAt && (
                      <Button variant="ghost" className="h-7 px-2 text-xs text-red-700 dark:text-red-400" onClick={() => revoke(k)}>
                        Revoke
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 font-medium">Create a key</h2>
        {error && (
          <div className="mb-3">
            <Alert>{error}</Alert>
          </div>
        )}
        <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="key-name" hint="What uses it, e.g. Website form sync">
            <Input id="key-name" name="name" required maxLength={100} />
          </Field>
          <Field label="Expires on (optional)" htmlFor="key-exp">
            <Input id="key-exp" name="expires" type="date" min={new Date().toISOString().slice(0, 10)} />
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Scopes</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {scopes.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="scopes" value={s} className="size-4 accent-brand-600" />
                  <span className="font-mono text-xs">{s}</span>
                  <span className="text-xs text-zinc-500">{SCOPE_HELP[s]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={busy}>
              Create key
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
