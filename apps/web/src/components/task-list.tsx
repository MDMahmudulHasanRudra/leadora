'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, formatDateTime } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import type { Task } from '@/lib/types';
import { PriorityBadge } from '@/app/(app)/leads/lead-bits';

export function TaskList({ items, timeZone, showLead = true }: { items: Task[]; timeZone: string; showLead?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function patch(id: string, body: object) {
    setError(null);
    try {
      await api(`/tasks/${id}`, { method: 'PATCH', body });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the task');
    }
  }

  if (!items.length) return <p className="p-6 text-center text-sm text-zinc-500">No tasks.</p>;
  return (
    <>
      {error && (
        <div className="p-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.map((task) => {
          const done = task.status === 'DONE';
          const overdue = !done && task.dueAt && new Date(task.dueAt).getTime() < Date.now();
          return (
            <li key={task.id} className="flex gap-3 px-4 py-3 text-sm">
              <input
                type="checkbox"
                checked={done}
                onChange={() => patch(task.id, { status: done ? 'OPEN' : 'DONE' })}
                aria-label={`Mark "${task.title}" ${done ? 'not done' : 'done'}`}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${done ? 'text-zinc-400 line-through' : ''}`}>{task.title}</p>
                <p className="text-xs text-zinc-500">
                  {task.dueAt ? `Due ${formatDateTime(task.dueAt, timeZone)}` : 'No due date'}
                  {overdue && <span className="font-medium text-red-700 dark:text-red-400"> · ⚠ overdue</span>}
                  {task.assignee && ` · ${task.assignee.fullName}`}
                  {showLead && task.lead && (
                    <>
                      {' · '}
                      <Link href={`/leads/${task.lead.id}`} className="text-brand-600 hover:underline">
                        {task.lead.fullName}
                      </Link>
                    </>
                  )}
                </p>
                {task.checklist.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {task.checklist.map((item, i) => (
                      <li key={i}>
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={item.done}
                            onChange={() =>
                              patch(task.id, { checklist: task.checklist.map((c, j) => (j === i ? { ...c, done: !c.done } : c)) })
                            }
                          />
                          <span className={item.done ? 'text-zinc-400 line-through' : ''}>{item.text}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <PriorityBadge priority={task.priority} />
            </li>
          );
        })}
      </ul>
    </>
  );
}
