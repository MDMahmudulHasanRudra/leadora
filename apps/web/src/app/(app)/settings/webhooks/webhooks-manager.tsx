'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Alert, Badge, Button, Card, Field, formatDateTime, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';

export interface Endpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  enabled: boolean;
  failureCount: number;
  disabledReason: string | null;
  delivered7d: number;
  failed7d: number;
}

interface Delivery {
  id: string;
  eventType: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
}

const errorText = (err: unknown) => (err instanceof ApiError ? (err.details[0]?.message ?? err.message) : 'Something went wrong');

function SecretNotice({ secret, onClose }: { secret: string; onClose: () => void }) {
  return (
    <Card className="space-y-3 border-amber-300 p-5 dark:border-amber-800">
      <p className="font-medium">Copy the signing secret now — it won’t be shown again.</p>
      <div className="flex items-center gap-2">
        <code className="font-mono text-xs break-all">{secret}</code>
        <Button variant="ghost" className="h-7" onClick={() => navigator.clipboard.writeText(secret)}>
          Copy
        </Button>
      </div>
      <p className="text-xs text-zinc-500">
        Verify each request: compute <code>HMAC-SHA256(secret, X-Webhook-Timestamp + &quot;.&quot; + raw body)</code> and compare its hex with the value after{' '}
        <code>v1=</code> in <code>X-Webhook-Signature</code>. Reject old timestamps, and use <code>X-Webhook-ID</code> to ignore repeats.
      </p>
      <Button variant="secondary" onClick={onClose}>
        I’ve saved it
      </Button>
    </Card>
  );
}

function EndpointCard({ ep, timeZone, onSecret }: { ep: Endpoint; timeZone: string; onSecret: (s: string) => void }) {
  const router = useRouter();
  const [log, setLog] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      router.refresh();
      if (log) setLog((await api<{ items: Delivery[] }>(`/webhooks/${ep.id}/deliveries`)).items);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="font-mono text-sm break-all">{ep.url}</p>
          <p className="text-xs text-zinc-500">
            {ep.events.includes('*') ? 'All events' : ep.events.join(', ')}
            {ep.description && ` · ${ep.description}`}
          </p>
          <p className="mt-1 text-xs text-zinc-500 tabular-nums">
            Last 7 days: {ep.delivered7d} delivered{ep.failed7d > 0 && <span className="text-red-700 dark:text-red-400"> · {ep.failed7d} failed</span>}
          </p>
          {ep.disabledReason && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{ep.disabledReason}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone={ep.enabled ? 'green' : 'red'}>{ep.enabled ? 'on' : 'off'}</Badge>
          <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => run(() => api(`/webhooks/${ep.id}`, { method: 'PATCH', body: { enabled: !ep.enabled } }))}>
            {ep.enabled ? 'Turn off' : 'Turn on'}
          </Button>
          <Button variant="ghost" className="h-7 px-2 text-xs" disabled={!ep.enabled} onClick={() => run(() => api(`/webhooks/${ep.id}/test`, { method: 'POST' }))}>
            Send test
          </Button>
          <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => run(async () => setLog((await api<{ items: Delivery[] }>(`/webhooks/${ep.id}/deliveries`)).items))}>
            Deliveries
          </Button>
          <Button
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() =>
              confirm('Rotate the secret? Requests are signed with the new secret immediately.') &&
              run(async () => onSecret((await api<{ secret: string }>(`/webhooks/${ep.id}/rotate-secret`, { method: 'POST' })).secret))
            }
          >
            Rotate secret
          </Button>
          <Button
            variant="ghost"
            className="h-7 px-2 text-xs text-red-700 dark:text-red-400"
            onClick={() => confirm(`Delete the webhook for ${ep.url}?`) && run(() => api(`/webhooks/${ep.id}`, { method: 'DELETE' }))}
          >
            Delete
          </Button>
        </div>
      </div>
      {error && (
        <div className="px-4 pb-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {log && (
        <div className="overflow-x-auto border-t border-zinc-100 dark:border-zinc-800">
          {log.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">No deliveries in the last 30 days.</p>
          ) : (
            <table className="w-full min-w-[480px] text-xs">
              <thead className="text-left text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Event</th>
                  <th className="px-4 py-2 font-medium">Result</th>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {log.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2 font-mono">{d.eventType}</td>
                    <td className="px-4 py-2">
                      <Badge tone={d.status === 'SUCCEEDED' ? 'green' : d.status === 'FAILED' ? 'red' : 'neutral'}>{d.status.toLowerCase()}</Badge>{' '}
                      <span className="text-zinc-500">
                        {d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : ''} · {d.attempts} {d.attempts === 1 ? 'attempt' : 'attempts'}
                      </span>
                      {d.lastError && d.status !== 'SUCCEEDED' && <span className="block text-red-700 dark:text-red-400">{d.lastError}</span>}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-zinc-500">{formatDateTime(d.createdAt, timeZone)}</td>
                    <td className="px-4 py-2 text-right">
                      {d.status === 'FAILED' && (
                        <Button variant="ghost" className="h-6 px-2 text-xs" onClick={() => run(() => api(`/webhooks/deliveries/${d.id}/redeliver`, { method: 'POST' }))}>
                          Redeliver
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}

export function WebhooksManager({ endpoints, events, timeZone }: { endpoints: Endpoint[]; events: string[]; timeZone: string }) {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ secret: string }>('/webhooks', {
        method: 'POST',
        body: { url: d.get('url'), description: String(d.get('description') ?? '') || undefined, events: d.getAll('events') },
      });
      setSecret(res.secret);
      form.reset();
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {secret && <SecretNotice secret={secret} onClose={() => setSecret(null)} />}
      {endpoints.length === 0 ? (
        <Card className="p-8 text-center text-sm text-zinc-500">No webhook endpoints yet.</Card>
      ) : (
        endpoints.map((ep) => <EndpointCard key={ep.id} ep={ep} timeZone={timeZone} onSecret={setSecret} />)
      )}
      <Card className="p-5">
        <h2 className="mb-4 font-medium">Add an endpoint</h2>
        {error && (
          <div className="mb-3">
            <Alert>{error}</Alert>
          </div>
        )}
        <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
          <Field label="URL" htmlFor="wh-url" hint="Public HTTPS address that accepts POST requests.">
            <Input id="wh-url" name="url" type="url" required placeholder="https://example.com/hooks/leadora" />
          </Field>
          <Field label="Description" htmlFor="wh-desc">
            <Input id="wh-desc" name="description" maxLength={300} />
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Events</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {events.map((ev) => (
                <label key={ev} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="events" value={ev} className="size-4 accent-brand-600" />
                  <span className="font-mono text-xs">{ev === '*' ? 'all events' : ev}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={busy}>
              Add endpoint
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
