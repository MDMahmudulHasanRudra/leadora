'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Alert, Button, Card, Field, Input, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import type { Team } from '@/lib/types';

type Person = { id: string; fullName: string };

export function TeamsManager({ teams, users, canManage }: { teams: Team[]; users: Person[]; canManage: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (!name) return;
    await run(() => api('/teams', { method: 'POST', body: { name } }));
    form.reset();
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}

      {canManage && (
        <Card className="p-4">
          <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <Field label="New team" htmlFor="team-name">
                <Input id="team-name" name="name" placeholder="e.g. Dhaka Inbound" maxLength={80} required />
              </Field>
            </div>
            <Button type="submit" disabled={pending}>
              Create team
            </Button>
          </form>
        </Card>
      )}

      {teams.length === 0 ? (
        <Card className="p-10 text-center text-sm text-zinc-500">No teams yet.</Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map((team) => (
            <TeamCard key={team.id} team={team} users={users} canManage={canManage} pending={pending} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}

function TeamCard({
  team,
  users,
  canManage,
  pending,
  run,
}: {
  team: Team;
  users: Person[];
  canManage: boolean;
  pending: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [adding, setAdding] = useState('');
  const memberIds = new Set(team.members.map((m) => m.id));
  const candidates = users.filter((u) => !memberIds.has(u.id));

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{team.name}</h2>
          {team.description && <p className="mt-0.5 text-sm text-zinc-500">{team.description}</p>}
          <p className="mt-1 text-xs text-zinc-400">
            {team.members.length} member{team.members.length === 1 ? '' : 's'}
          </p>
        </div>
        {canManage && (
          <Button
            variant="ghost"
            className="h-8 text-red-600 dark:text-red-400"
            disabled={pending}
            onClick={() => {
              if (confirm(`Delete team "${team.name}"? Members keep their accounts.`)) {
                void run(() => api(`/teams/${team.id}`, { method: 'DELETE' }));
              }
            }}
          >
            Delete
          </Button>
        )}
      </div>

      <ul className="mt-4 flex flex-wrap gap-2">
        {team.members.map((m) => (
          <li key={m.id} className="flex items-center gap-1 rounded-full bg-zinc-100 py-1 pr-1 pl-3 text-sm dark:bg-zinc-800">
            {m.fullName}
            {canManage && (
              <button
                aria-label={`Remove ${m.fullName} from ${team.name}`}
                disabled={pending}
                onClick={() => run(() => api(`/teams/${team.id}/members/${m.id}`, { method: 'DELETE' }))}
                className="grid size-5 place-items-center rounded-full text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:hover:bg-zinc-700"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      {canManage && candidates.length > 0 && (
        <div className="mt-4 flex gap-2">
          <Select aria-label={`Add member to ${team.name}`} value={adding} onChange={(e) => setAdding(e.target.value)} className="h-8">
            <option value="">Add member…</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            className="h-8"
            disabled={!adding || pending}
            onClick={async () => {
              await run(() => api(`/teams/${team.id}/members/${adding}`, { method: 'PUT' }));
              setAdding('');
            }}
          >
            Add
          </Button>
        </div>
      )}
    </Card>
  );
}
