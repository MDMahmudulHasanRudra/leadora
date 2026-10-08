'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, formatDateTime } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import type { Followup } from '@/lib/types';

const TYPE_LABEL: Record<string, string> = { CALL: 'Call', EMAIL: 'Email', MESSAGE: 'Message', MEETING: 'Meeting', CUSTOM: 'Follow-up' };

export function FollowupList({
  items,
  timeZone,
  showLead = true,
  empty = 'Nothing scheduled.',
}: {
  items: Followup[];
  timeZone: string;
  showLead?: boolean;
  empty?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function close(f: Followup, status: 'COMPLETED' | 'SKIPPED') {
    const outcome = status === 'COMPLETED' ? (prompt('How did it go? (optional)') ?? undefined) : undefined;
    setBusy(f.id);
    setError(null);
    try {
      await api(`/followups/${f.id}`, { method: 'PATCH', body: { status, ...(outcome ? { outcome } : {}) } });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the follow-up');
    } finally {
      setBusy(null);
    }
  }

  if (!items.length) return <p className="p-6 text-center text-sm text-zinc-500">{empty}</p>;
  return (
    <>
      {error && (
        <div className="p-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">
                {TYPE_LABEL[f.type]}
                {showLead && (
                  <>
                    {' · '}
                    <Link href={`/leads/${f.lead.id}`} className="text-brand-600 hover:underline">
                      {f.lead.fullName}
                    </Link>
                  </>
                )}
              </p>
              <p className="text-xs text-zinc-500">
                {f.status === 'PENDING' ? formatDateTime(f.scheduledAt, timeZone) : `${f.status.toLowerCase()} ${formatDateTime(f.completedAt, timeZone)}`}
                {f.assignee && ` · ${f.assignee.fullName}`}
                {f.notes && ` · ${f.notes}`}
                {f.outcome && ` · ${f.outcome}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {f.overdue && (
                <Badge tone="red">
                  <span aria-hidden>⚠&nbsp;</span>overdue
                </Badge>
              )}
              {f.status === 'PENDING' && (
                <>
                  <Button variant="secondary" className="h-8" disabled={busy === f.id} onClick={() => close(f, 'COMPLETED')}>
                    Done
                  </Button>
                  <Button variant="ghost" className="h-8" disabled={busy === f.id} onClick={() => close(f, 'SKIPPED')}>
                    Skip
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
