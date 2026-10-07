'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Alert, Badge, Button, Card, Field, formatDateTime, Input, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import { ROLES, type UserRow } from '@/lib/types';

interface Props {
  users: UserRow[];
  currentUserId: string;
  timeZone: string;
  can: { create: boolean; update: boolean; disable: boolean };
}

export function UsersManager({ users, currentUserId, timeZone, can }: Props) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function update(id: string, body: object) {
    setBusyId(id);
    setError(null);
    try {
      await api(`/users/${id}`, { method: 'PATCH', body });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {can.create && (
        <div className="flex justify-end">
          <Button onClick={() => setShowForm((v) => !v)} variant={showForm ? 'secondary' : 'primary'}>
            {showForm ? 'Cancel' : 'Add user'}
          </Button>
        </div>
      )}
      {showForm && <CreateUserForm onDone={() => (setShowForm(false), router.refresh())} />}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last sign-in</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {users.map((u) => {
              const self = u.id === currentUserId;
              const busy = busyId === u.id;
              return (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {u.fullName} {self && <span className="text-xs font-normal text-zinc-400">(you)</span>}
                    </div>
                    <div className="text-xs text-zinc-500">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {can.update && !self ? (
                      <Select
                        aria-label={`Role for ${u.fullName}`}
                        value={u.role ?? ''}
                        disabled={busy}
                        onChange={(e) => update(u.id, { role: e.target.value })}
                        className="h-8 w-32"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r.charAt(0) + r.slice(1).toLowerCase()}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge tone="brand">{u.role ?? '—'}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={u.status === 'ACTIVE' ? 'green' : u.status === 'DISABLED' ? 'red' : 'neutral'}>
                      {u.status.toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-zinc-500">{formatDateTime(u.lastLoginAt, timeZone)}</td>
                  <td className="px-4 py-3 text-right">
                    {can.disable && !self && (
                      <Button
                        variant={u.status === 'DISABLED' ? 'secondary' : 'danger'}
                        className="h-8"
                        disabled={busy}
                        onClick={() => update(u.id, { status: u.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED' })}
                      >
                        {u.status === 'DISABLED' ? 'Enable' : 'Disable'}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const fe = (p: string) => error?.fieldError(p);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/users', { method: 'POST', body: Object.fromEntries(new FormData(e.currentTarget)) });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'NETWORK', 'Could not reach the server.'));
      setPending(false);
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && error.code !== 'VALIDATION_FAILED' && (
          <div className="sm:col-span-2">
            <Alert>{error.message}</Alert>
          </div>
        )}
        <Field label="Full name" htmlFor="new-fullName" error={fe('fullName')}>
          <Input id="new-fullName" name="fullName" required invalid={!!fe('fullName')} />
        </Field>
        <Field label="Email" htmlFor="new-email" error={fe('email')}>
          <Input id="new-email" name="email" type="email" required invalid={!!fe('email')} />
        </Field>
        <Field label="Role" htmlFor="new-role" error={fe('role')}>
          <Select id="new-role" name="role" defaultValue="AGENT">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.charAt(0) + r.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Initial password" htmlFor="new-password" error={fe('password')} hint="At least 12 characters. Share it securely.">
          <Input id="new-password" name="password" type="password" autoComplete="new-password" required invalid={!!fe('password')} />
        </Field>
        <div className="sm:col-span-2 flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Create user'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
