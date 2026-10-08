import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TaskList } from '@/components/task-list';
import { Card, PageHeader } from '@/components/ui';
import { getIdentity, requireData } from '@/lib/api-server';
import type { Page, Task } from '@/lib/types';
import { NewTaskForm } from './new-task-form';

export const dynamic = 'force-dynamic';

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('followup.view')) redirect('/');
  const done = (await searchParams).status === 'done';
  const { items } = await requireData<Page<Task>>(`/tasks?assignee=me&status=${done ? 'done' : 'open'}`);

  return (
    <>
      <PageHeader title="My tasks" description="Your to-dos, soonest due first." />
      {identity.permissions.includes('followup.create') && (
        <Card className="mb-4 p-4">
          <NewTaskForm />
        </Card>
      )}
      <nav className="mb-4 flex gap-1" aria-label="Status">
        {[
          ['Open', '/tasks', !done],
          ['Done', '/tasks?status=done', done],
        ].map(([label, href, active]) => (
          <Link
            key={label as string}
            href={href as string}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 text-sm ${
              active ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Card>
        <TaskList items={items} timeZone={identity.user.timezone} />
      </Card>
    </>
  );
}
