'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Alert, Badge, Button, Card, Field, formatDateTime, Input, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';

export interface FormRow {
  id: string;
  name: string;
  publicKey: string;
  title: string | null;
  successMessage: string;
  fields: { email: string; phone: string; companyName: string; message: string };
  allowedOrigins: string[];
  captchaProvider: 'NONE' | 'TURNSTILE' | 'HCAPTCHA';
  tags: string[];
  enabled: boolean;
  submissionCount: number;
  lastSubmissionAt: string | null;
  embedCode: string;
}

const errorText = (err: unknown) => (err instanceof ApiError ? (err.details[0] ? `${err.details[0].path}: ${err.details[0].message}` : err.message) : 'Something went wrong');

function FormCard({ form, timeZone }: { form: FormRow; timeZone: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{form.name}</p>
          <p className="text-xs text-zinc-500">
            {form.submissionCount} submissions{form.lastSubmissionAt && ` · last ${formatDateTime(form.lastSubmissionAt, timeZone)}`}
            {' · '}
            {form.allowedOrigins.length ? form.allowedOrigins.join(', ') : 'any website'}
            {form.captchaProvider !== 'NONE' && ` · ${form.captchaProvider.toLowerCase()} CAPTCHA`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Badge tone={form.enabled ? 'green' : 'neutral'}>{form.enabled ? 'live' : 'off'}</Badge>
          <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => run(() => api(`/lead-forms/${form.id}`, { method: 'PATCH', body: { enabled: !form.enabled } }))}>
            {form.enabled ? 'Turn off' : 'Turn on'}
          </Button>
          <Button
            variant="ghost"
            className="h-7 px-2 text-xs text-red-700 dark:text-red-400"
            onClick={() => confirm(`Delete “${form.name}”? The embed stops working.`) && run(() => api(`/lead-forms/${form.id}`, { method: 'DELETE' }))}
          >
            Delete
          </Button>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-zinc-500">Paste this where the form should appear:</span>
          <Button
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={async () => {
              await navigator.clipboard.writeText(form.embedCode);
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <pre className="overflow-x-auto rounded-md bg-zinc-50 p-3 text-xs dark:bg-zinc-800">{form.embedCode}</pre>
      </div>
    </Card>
  );
}

export function FormsManager({ forms, timeZone }: { forms: FormRow[]; timeZone: string }) {
  const router = useRouter();
  const [captcha, setCaptcha] = useState<'NONE' | 'TURNSTILE' | 'HCAPTCHA'>('NONE');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const d = new FormData(formEl);
    const list = (name: string, sep: RegExp) =>
      String(d.get(name) ?? '')
        .split(sep)
        .map((s) => s.trim())
        .filter(Boolean);
    setBusy(true);
    setError(null);
    try {
      await api('/lead-forms', {
        method: 'POST',
        body: {
          name: d.get('name'),
          title: String(d.get('title') ?? '') || null,
          successMessage: String(d.get('successMessage') ?? '') || undefined,
          fields: { email: d.get('email'), phone: d.get('phone'), companyName: d.get('companyName'), message: d.get('message') },
          allowedOrigins: list('origins', /\s+/),
          tags: list('tags', /,/),
          captcha: captcha === 'NONE' ? undefined : { provider: captcha, siteKey: d.get('siteKey'), secret: d.get('secret') },
        },
      });
      formEl.reset();
      setCaptcha('NONE');
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const fieldSelect = (name: string, label: string, options: string[], def: string) => (
    <Field label={label} htmlFor={`f-${name}`}>
      <Select id={`f-${name}`} name={name} defaultValue={def}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <div className="space-y-6">
      {forms.length === 0 ? <Card className="p-8 text-center text-sm text-zinc-500">No forms yet.</Card> : forms.map((f) => <FormCard key={f.id} form={f} timeZone={timeZone} />)}
      <Card className="p-5">
        <h2 className="mb-4 font-medium">Create a form</h2>
        {error && (
          <div className="mb-3">
            <Alert>{error}</Alert>
          </div>
        )}
        <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name (internal)" htmlFor="f-name">
            <Input id="f-name" name="name" required maxLength={100} placeholder="Pricing page form" />
          </Field>
          <Field label="Heading shown on the form" htmlFor="f-title">
            <Input id="f-title" name="title" maxLength={200} placeholder="Get a quote" />
          </Field>
          {fieldSelect('email', 'Email', ['required', 'optional', 'hidden'], 'required')}
          {fieldSelect('phone', 'Phone', ['required', 'optional', 'hidden'], 'optional')}
          {fieldSelect('companyName', 'Company', ['optional', 'hidden'], 'optional')}
          {fieldSelect('message', 'Message', ['optional', 'hidden'], 'optional')}
          <Field label="Websites allowed to use it" htmlFor="f-origins" hint="One origin per line, e.g. https://www.yourshop.com. Leave empty for any.">
            <textarea id="f-origins" name="origins" rows={2} className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </Field>
          <Field label="Tags for new leads" htmlFor="f-tags" hint="Comma separated">
            <Input id="f-tags" name="tags" placeholder="website, quote" />
          </Field>
          <Field label="Thank-you message" htmlFor="f-success">
            <Input id="f-success" name="successMessage" maxLength={500} placeholder="Thanks! We will be in touch soon." />
          </Field>
          <Field label="CAPTCHA" htmlFor="f-captcha" hint="Optional bot protection on top of the built-in honeypot and rate limits.">
            <Select id="f-captcha" value={captcha} onChange={(e) => setCaptcha(e.target.value as typeof captcha)}>
              <option value="NONE">None</option>
              <option value="TURNSTILE">Cloudflare Turnstile</option>
              <option value="HCAPTCHA">hCaptcha</option>
            </Select>
          </Field>
          {captcha !== 'NONE' && (
            <>
              <Field label="Site key" htmlFor="f-sitekey">
                <Input id="f-sitekey" name="siteKey" required />
              </Field>
              <Field label="Secret key" htmlFor="f-secret" hint="Stored encrypted; never shown again.">
                <Input id="f-secret" name="secret" type="password" autoComplete="off" required />
              </Field>
            </>
          )}
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={busy}>
              Create form
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
