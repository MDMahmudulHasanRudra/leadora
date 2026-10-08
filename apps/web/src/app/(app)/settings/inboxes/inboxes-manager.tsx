'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Alert, Button, Card, Field, Input, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';

interface Created {
  inbox: { id: string; name: string };
  webhookSecret?: string;
  webhookUrl?: string;
  embedCode?: string;
}

const chatEmbed = (widgetKey: string) => `<script src="${typeof window === 'undefined' ? '' : window.location.origin}/chat-widget.js" data-widget-key="${widgetKey}" async></script>`;

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      className="h-7"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </Button>
  );
}

export function InboxesManager({ inboxes }: { inboxes: { id: string; name: string; channel: string; address: string }[] }) {
  const router = useRouter();
  const [channel, setChannel] = useState<'EMAIL' | 'WEB_CHAT'>('EMAIL');
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const body =
      channel === 'EMAIL'
        ? { name: data.get('name'), channel, address: data.get('address') }
        : {
            name: data.get('name'),
            channel,
            config: {
              allowedOrigins: String(data.get('origins') ?? '')
                .split(/\s+/)
                .map((s) => s.trim())
                .filter(Boolean),
              title: String(data.get('title') ?? '') || undefined,
              greeting: String(data.get('greeting') ?? '') || undefined,
            },
          };
    setBusy(true);
    setError(null);
    try {
      setCreated(await api<Created>('/inboxes', { method: 'POST', body }));
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? (err.details[0] ? `${err.details[0].path}: ${err.details[0].message}` : err.message) : 'Could not create the inbox');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      {created?.webhookSecret && (
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
                <Copy text={created.webhookSecret} />
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
              <li key={i.id} className="space-y-2 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{i.name}</p>
                  <p className="text-xs text-zinc-500">{i.channel === 'WEB_CHAT' ? 'website chat' : `${i.channel.toLowerCase()} · ${i.address}`}</p>
                </div>
                {i.channel === 'WEB_CHAT' && (
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-500">Add this before &lt;/body&gt; on your website:</span>
                      <Copy text={chatEmbed(i.address)} />
                    </div>
                    <pre className="overflow-x-auto rounded-md bg-zinc-50 p-2 text-xs dark:bg-zinc-800">{chatEmbed(i.address)}</pre>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 font-medium">Add an inbox</h2>
        <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
          <Field label="Channel" htmlFor="channel">
            <Select id="channel" value={channel} onChange={(e) => setChannel(e.target.value as 'EMAIL' | 'WEB_CHAT')}>
              <option value="EMAIL">Email</option>
              <option value="WEB_CHAT">Website chat</option>
            </Select>
          </Field>
          <Field label="Name" htmlFor="name">
            <Input id="name" name="name" required maxLength={100} placeholder={channel === 'EMAIL' ? 'Sales email' : 'Website chat'} />
          </Field>
          {channel === 'EMAIL' ? (
            <Field label="Email address" htmlFor="address" hint="Customers see this as the sender.">
              <Input id="address" name="address" type="email" required placeholder="sales@yourcompany.com" />
            </Field>
          ) : (
            <>
              <Field label="Websites allowed" htmlFor="origins" hint="One origin per line, e.g. https://www.yourshop.com. Empty = any.">
                <textarea id="origins" name="origins" rows={2} className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
              </Field>
              <Field label="Chat title" htmlFor="title">
                <Input id="title" name="title" maxLength={80} placeholder="Chat with us" />
              </Field>
              <Field label="Greeting" htmlFor="greeting">
                <Input id="greeting" name="greeting" maxLength={300} placeholder="Hi! How can we help?" />
              </Field>
            </>
          )}
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={busy}>
              Create inbox
            </Button>
          </div>
        </form>
      </Card>
      <p className="text-xs text-zinc-500">WhatsApp, Facebook and Instagram connect through Meta — see below once configured.</p>
    </div>
  );
}
