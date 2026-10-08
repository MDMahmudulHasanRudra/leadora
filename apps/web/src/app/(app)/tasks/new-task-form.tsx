'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Alert, Button, Input, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import { PRIORITIES } from '@/lib/types';

/** Quick-add: title, optional due date/priority, checklist lines after the first line. */
export function NewTaskForm({ leadId }: { leadId?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const due = String(data.get('dueAt') ?? '');
    const checklist = String(data.get('checklist') ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    setBusy(true);
    setError(null);
    try {
      await api('/tasks', {
        method: 'POST',
        body: {
          title: data.get('title'),
          priority: data.get('priority'),
          ...(due ? { dueAt: new Date(due).toISOString() } : {}),
          ...(checklist.length ? { checklist } : {}),
          ...(leadId ? { leadId } : {}),
        },
      });
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? (err.details[0]?.message ?? err.message) : 'Could not add the task');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Input name="title" placeholder="Add a task…" required maxLength={200} aria-label="Task title" className="min-w-48 flex-1" />
        <Input name="dueAt" type="datetime-local" aria-label="Due" className="w-auto" />
        <Select name="priority" defaultValue="MEDIUM" aria-label="Priority" className="w-auto">
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0) + p.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={busy}>
          Add
        </Button>
      </div>
      <textarea
        name="checklist"
        rows={2}
        placeholder="Checklist (optional, one item per line)"
        aria-label="Checklist"
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
    </form>
  );
}
