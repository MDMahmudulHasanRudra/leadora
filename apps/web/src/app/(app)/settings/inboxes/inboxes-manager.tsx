'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';

interface Created {
  inbox: { id: string; name: string };
  webhookSecret: string;
  webhookUrl: string;
}

export function InboxesManager({ inboxes }: { inboxes: { id: string; name: string; channel: string; address: string }[] }) {
  const router = useRouter();
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      setCreated(await api<Created>('/inboxes', { method: 'POST', body: { name: data.get('name'), channel: 'EMAIL', address: data.get('address') } }));
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? (err.details[0]?.message ?? err.message) : 'Could not create the inbox');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      {created && (
        <Card className="space-y-3 border-amber-300 p-5 dark:border-amber-800">
          <p className="font-medium">“{created.inbox.name}” is ready. Copy the webhook secret now — it won’t be shown again.</p>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-zinc-500">Inbound webhook URL (point your mail relay here)</dt>
              <dd className="font-mono text-xs break-all">{created.webhookUrl}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Signing secret</dt>
              <dd className="flex items-center gap-2">
                <code className="font-mono text-xs break-all">{created.webhookSecret}</code>
                <Button variant="ghost" className="h-7" onClick={() => navigator.clipboard.writeText(created.webhookSecret)}>
                  Copy
                </Button>
              </dd>
            </div>
          </dl>
          <p className="text-xs text-zinc-500">
            Sign each request with headers <code>X-Leadora-Timestamp</code> (Unix seconds) and{' '}
            <code>X-Leadora-Signature: v1=&lt;hex HMAC-SHA256(secret, timestamp + &quot;.&quot; + body)&gt;</code>.
          </p>
          <Button variant="secondary" onClick={() => setCreated(null)}>
            I’ve saved it
          </Button>
        </Card>
      )}
      <Card>
        {inboxes.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">No inboxes yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {inboxes.map((i) => (
              <li key={i.id} className="px-4 py-3 text-sm">
                <p className="font-medium">{i.name}</p>
                <p className="text-xs text-zinc-500">
                  {i.channel.toLowerCase()} · {i.address}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 font-medium">Add an email inbox</h2>
        <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name">
            <Input id="name" name="name" required maxLength={100} placeholder="Sales email" />
          </Field>
          <Field label="Email address" htmlFor="address" hint="Customers see this as the sender.">
            <Input id="address" name="address" type="email" required placeholder="sales@yourcompany.com" />
          </Field>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={busy}>
              Create inbox
            </Button>
          </div>
        </form>
      </Card>
      <p className="text-xs text-zinc-500">WhatsApp, Facebook, Instagram and website chat arrive in Phase 7.</p>
    </div>
  );
}
