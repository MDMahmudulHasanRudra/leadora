'use client';

import { useState } from 'react';
import { Alert, Button, Card, formatDateTime } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import type { AuditEntry, Page } from '@/lib/types';

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

function describeChange(e: AuditEntry): string {
  const keys = new Set([...Object.keys(e.oldValues ?? {}), ...Object.keys(e.newValues ?? {})]);
  return [...keys]
    .filter((k) => e.oldValues?.[k] != null || e.newValues?.[k] != null)
    .map((k) => {
      const before = e.oldValues?.[k];
      const after = e.newValues?.[k];
      if (e.oldValues && e.newValues && k in e.oldValues && k in e.newValues) return `${k}: ${show(before)} → ${show(after)}`;
      return `${k}: ${show(after ?? before)}`;
    })
    .join(', ');
}

export function AuditTable({ initial, timeZone }: { initial: Page<AuditEntry>; timeZone: string }) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page<AuditEntry>>(`/audit-logs?limit=50&cursor=${encodeURIComponent(cursor)}`);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more entries');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Who</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {items.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="px-4 py-3 whitespace-nowrap text-zinc-500 tabular-nums">{formatDateTime(e.createdAt, timeZone)}</td>
                <td className="px-4 py-3">{e.actor?.fullName ?? <span className="text-zinc-400">system</span>}</td>
                <td className="px-4 py-3">
                  <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">{e.action}</code>
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{describeChange(e) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p className="p-10 text-center text-sm text-zinc-500">No activity yet.</p>}
      </Card>
      {cursor && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
