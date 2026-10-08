'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import { ApiError } from '@/lib/api-client';
import { type Lead, PRIORITIES, type Stage } from '@/lib/types';
import { titleCase } from './lead-bits';

export interface LeadFormProps {
  initial?: Lead;
  stages?: Stage[];
  owners?: { id: string; fullName: string }[];
  submitLabel: string;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
}

const TEXT = ['fullName', 'email', 'phone', 'companyName', 'jobTitle', 'location', 'industry', 'notes'] as const;

/** Create sends only filled fields; edit sends every text field so emptied ones are cleared. */
function toBody(form: FormData, editing: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of TEXT) {
    const value = String(form.get(key) ?? '').trim();
    if (value || (editing && key !== 'email' && key !== 'phone' && key !== 'fullName')) body[key] = value;
  }
  body.priority = form.get('priority');
  body.tags = String(form.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (form.has('stageId')) body.stageId = form.get('stageId');
  if (form.has('ownerUserId')) body.ownerUserId = form.get('ownerUserId') || null;
  return body;
}

export function LeadForm({ initial, stages, owners, submitLabel, onSubmit, onCancel }: LeadFormProps) {
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fe = (p: string) => error?.fieldError(p);

  // The submit button sits below the fold on long forms; bring the problem into view.
  useEffect(() => {
    if (!error) return;
    const target = formRef.current?.querySelector<HTMLElement>('[role="alert"], [aria-invalid="true"]');
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit(toBody(new FormData(e.currentTarget), !!initial));
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'NETWORK', 'Could not reach the server. Please try again.'));
    } finally {
      setPending(false);
    }
  }

  const duplicateId = error?.code === 'LEAD_DUPLICATE' ? (error.raw as { existingLeadId?: string } | undefined)?.existingLeadId : undefined;

  return (
    <form ref={formRef} onSubmit={handle} className="grid gap-4 sm:grid-cols-2" noValidate>
      {error && error.code !== 'VALIDATION_FAILED' && (
        <div className="sm:col-span-2">
          <Alert>
            {error.message}
            {duplicateId && (
              <>
                .{' '}
                <Link href={`/leads/${duplicateId}`} className="font-medium underline">
                  Open the existing lead
                </Link>
              </>
            )}
          </Alert>
        </div>
      )}
      <Field label="Full name" htmlFor="fullName" error={fe('fullName')}>
        <Input id="fullName" name="fullName" defaultValue={initial?.fullName} required maxLength={200} invalid={!!fe('fullName')} />
      </Field>
      <Field label="Company" htmlFor="companyName" error={fe('companyName')}>
        <Input id="companyName" name="companyName" defaultValue={initial?.companyName ?? ''} maxLength={200} />
      </Field>
      <Field label="Email" htmlFor="email" error={fe('email')}>
        <Input id="email" name="email" type="email" defaultValue={initial?.email ?? ''} invalid={!!fe('email')} />
      </Field>
      <Field label="Phone" htmlFor="phone" error={fe('phone')} hint="Local numbers use your organization’s country.">
        <Input id="phone" name="phone" type="tel" defaultValue={initial?.phone ?? ''} invalid={!!fe('phone')} />
      </Field>
      <Field label="Job title" htmlFor="jobTitle">
        <Input id="jobTitle" name="jobTitle" defaultValue={initial?.jobTitle ?? ''} maxLength={120} />
      </Field>
      <Field label="Location" htmlFor="location">
        <Input id="location" name="location" defaultValue={initial?.location ?? ''} maxLength={200} />
      </Field>
      <Field label="Industry" htmlFor="industry">
        <Input id="industry" name="industry" defaultValue={initial?.industry ?? ''} maxLength={120} />
      </Field>
      <Field label="Priority" htmlFor="priority">
        <Select id="priority" name="priority" defaultValue={initial?.priority ?? 'MEDIUM'}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {titleCase(p)}
            </option>
          ))}
        </Select>
      </Field>
      {stages && (
        <Field label="Stage" htmlFor="stageId">
          <Select id="stageId" name="stageId" defaultValue={stages[0]?.id}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {owners && (
        <Field label="Owner" htmlFor="ownerUserId">
          <Select id="ownerUserId" name="ownerUserId" defaultValue={owners[0]?.id}>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.fullName}
              </option>
            ))}
            <option value="">Unassigned</option>
          </Select>
        </Field>
      )}
      <div className="sm:col-span-2">
        <Field label="Tags" htmlFor="tags" error={fe('tags')} hint="Separate with commas, e.g. VIP, Dhaka">
          <Input id="tags" name="tags" defaultValue={initial?.tags.join(', ') ?? ''} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Notes" htmlFor="notes">
          <textarea
            id="notes"
            name="notes"
            rows={3}
            maxLength={5000}
            defaultValue={initial?.notes ?? ''}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
