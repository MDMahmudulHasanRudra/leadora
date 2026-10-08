'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type DragEvent, useState } from 'react';
import { Alert } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import { formatAmount } from '@/lib/format';
import { PriorityBadge } from '../leads/lead-bits';
import type { BoardColumn } from './page';

export function Board({ initial, canMove }: { initial: BoardColumn[]; canMove: boolean }) {
  const router = useRouter();
  const [columns, setColumns] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function move(leadId: string, toStageId: string) {
    const from = columns.find((c) => c.leads.some((l) => l.id === leadId));
    if (!from || from.id === toStageId) return;
    const lead = from.leads.find((l) => l.id === leadId)!;
    const previous = columns;
    // Optimistic: move the card now, roll back if the server refuses.
    setColumns((cols) =>
      cols.map((c) =>
        c.id === from.id
          ? { ...c, count: c.count - 1, leads: c.leads.filter((l) => l.id !== leadId) }
          : c.id === toStageId
            ? { ...c, count: c.count + 1, leads: [lead, ...c.leads] }
            : c,
      ),
    );
    setError(null);
    api(`/leads/${leadId}`, { method: 'PATCH', body: { stageId: toStageId } })
      .then(() => router.refresh())
      .catch((err) => {
        setColumns(previous);
        setError(err instanceof ApiError ? err.message : 'Could not move the lead');
      });
  }

  const onDrop = (e: DragEvent, stageId: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/lead-id');
    setOver(null);
    setDragging(null);
    if (id) move(id, stageId);
  };

  return (
    <div className="space-y-3">
      {error && <Alert>{error}</Alert>}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
        {columns.map((col) => (
          <section
            key={col.id}
            aria-label={`${col.name}, ${col.count} lead${col.count === 1 ? '' : 's'}`}
            onDragOver={(e) => {
              if (!canMove || !dragging) return;
              e.preventDefault();
              setOver(col.id);
            }}
            onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
            onDrop={(e) => onDrop(e, col.id)}
            className={`flex w-64 shrink-0 flex-col rounded-xl border bg-zinc-100/60 dark:bg-zinc-900/60 ${
              over === col.id ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-zinc-200 dark:border-zinc-800'
            }`}
          >
            <header className="flex items-center justify-between px-3 py-2.5">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="size-2 rounded-full" style={{ backgroundColor: col.color }} aria-hidden />
                {col.name}
              </span>
              <span className="text-xs text-zinc-500 tabular-nums">{col.count}</span>
            </header>
            <ol className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
              {col.leads.map((lead) => (
                <li
                  key={lead.id}
                  draggable={canMove}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/lead-id', lead.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragging(lead.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={`rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-xs dark:border-zinc-700 dark:bg-zinc-900 ${
                    canMove ? 'cursor-grab active:cursor-grabbing' : ''
                  } ${dragging === lead.id ? 'opacity-50' : ''}`}
                >
                  <Link href={`/leads/${lead.id}`} className="font-medium hover:text-brand-600 hover:underline" draggable={false}>
                    {lead.fullName}
                  </Link>
                  {lead.companyName && <p className="truncate text-xs text-zinc-500">{lead.companyName}</p>}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <PriorityBadge priority={lead.priority} />
                    <span className="truncate text-xs text-zinc-500">{lead.owner?.fullName ?? 'Unassigned'}</span>
                  </div>
                  {lead.budget != null && <p className="mt-1 text-xs text-zinc-500 tabular-nums">{formatAmount(lead.budget)}</p>}
                </li>
              ))}
              {col.count > col.leads.length && (
                <li className="px-1 text-xs text-zinc-500">
                  +{col.count - col.leads.length} more ·{' '}
                  <Link href={`/leads?stageId=${col.id}`} className="text-brand-600 hover:underline">
                    view all
                  </Link>
                </li>
              )}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
