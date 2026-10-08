'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, formatDateTime, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import { useRealtime } from '@/lib/realtime';

export interface ConversationItem {
  id: string;
  subject: string | null;
  status: 'OPEN' | 'PENDING' | 'RESOLVED';
  unread: boolean;
  waitingOn: 'AGENT' | 'CUSTOMER' | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  inbox: { id: string; name: string; channel: string };
  lead: { id: string; fullName: string; email: string | null; phone: string | null };
  assignee: { id: string; fullName: string } | null;
}

export interface MessageItem {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND' | 'INTERNAL';
  content: string;
  status: string;
  error: string | null;
  createdAt: string;
  sender: { id: string; fullName?: string } | null;
}

const VIEW_LABELS: [string, string][] = [
  ['all', 'All open'],
  ['mine', 'Mine'],
  ['unassigned', 'Unassigned'],
  ['unread', 'Unread'],
  ['waiting_agent', 'Waiting on us'],
  ['waiting_customer', 'Waiting on customer'],
  ['resolved', 'Resolved'],
];

const STATUS_LABEL: Record<string, string> = { QUEUED: 'sending…', SENT: 'sent', FAILED: 'failed', RECEIVED: 'received' };

export function InboxView({
  view,
  conversations,
  selected,
  messages,
  users,
  timeZone,
  can,
}: {
  view: string;
  conversations: ConversationItem[];
  selected: ConversationItem | null;
  messages: MessageItem[];
  users: { id: string; fullName: string }[];
  timeZone: string;
  can: { reply: boolean; assign: boolean };
}) {
  const router = useRouter();
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const thread = useRef<HTMLOListElement>(null);
  const href = (params: { view?: string; c?: string }) => {
    const q = new URLSearchParams({ view: params.view ?? view, ...(params.c ? { c: params.c } : {}) });
    return `/inbox?${q}`;
  };

  useRealtime((e) => {
    if (['conversation.updated', 'message.created', 'message.updated'].includes(e.type)) router.refresh();
  });

  useEffect(() => {
    thread.current?.lastElementChild?.scrollIntoView({ block: 'end' });
    if (selected?.unread) void api(`/conversations/${selected.id}/read`, { method: 'POST' }).then(() => router.refresh());
  }, [selected?.id, selected?.unread, messages.length, router]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onSend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const form = e.currentTarget;
    const body = String(new FormData(form).get('body') ?? '').trim();
    if (!body) return;
    if (await run(() => api(`/conversations/${selected.id}/messages`, { method: 'POST', body: { body, internal } }))) form.reset();
  }

  return (
    <div className="-my-6 grid h-[calc(100vh-3rem)] min-h-[32rem] gap-4 md:-my-10 md:h-[calc(100vh-5rem)] lg:grid-cols-[18rem_1fr_16rem]">
      {/* Conversation list */}
      <Card className={`flex min-h-0 flex-col overflow-hidden ${selected ? 'hidden lg:flex' : 'flex'}`}>
        <div className="border-b border-zinc-100 p-2 dark:border-zinc-800">
          <Select aria-label="Inbox view" value={view} onChange={(e) => router.push(href({ view: e.target.value }))} className="h-8">
            {VIEW_LABELS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
          {conversations.length === 0 && <li className="p-6 text-center text-sm text-zinc-500">No conversations here.</li>}
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={href({ c: c.id })}
                aria-current={selected?.id === c.id ? 'page' : undefined}
                className={`block px-3 py-2.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 ${selected?.id === c.id ? 'bg-brand-50 dark:bg-zinc-800' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate ${c.unread ? 'font-semibold' : 'font-medium'}`}>{c.lead.fullName}</span>
                  {c.lastMessageAt && <span className="shrink-0 text-xs text-zinc-500">{formatDateTime(c.lastMessageAt, timeZone)}</span>}
                </div>
                <p className="truncate text-xs text-zinc-500">{c.subject ?? c.inbox.name}</p>
                <p className={`truncate text-xs ${c.unread ? 'text-zinc-800 dark:text-zinc-200' : 'text-zinc-500'}`}>
                  {c.unread && <span className="mr-1 inline-block size-1.5 rounded-full bg-brand-600 align-middle" aria-label="unread" />}
                  {c.lastMessagePreview}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {/* Thread */}
      <Card className={`flex min-h-0 flex-col overflow-hidden ${selected ? 'flex' : 'hidden lg:flex'}`}>
        {!selected ? (
          <p className="m-auto p-6 text-sm text-zinc-500">Choose a conversation.</p>
        ) : (
          <>
            <header className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
              <div className="min-w-0">
                <Link href={href({})} className="mr-2 text-sm text-zinc-500 lg:hidden">
                  ←
                </Link>
                <span className="font-medium">{selected.subject ?? `Conversation with ${selected.lead.fullName}`}</span>
                <p className="truncate text-xs text-zinc-500">
                  {selected.inbox.name} · {selected.lead.email ?? selected.lead.phone}
                </p>
              </div>
              {selected.status === 'RESOLVED' ? <Badge tone="green">resolved</Badge> : selected.waitingOn === 'AGENT' && <Badge tone="red">needs reply</Badge>}
            </header>
            <ol ref={thread} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {messages.map((m) => {
                const mine = m.direction !== 'INBOUND';
                return (
                  <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        m.direction === 'INTERNAL'
                          ? 'border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
                          : mine
                            ? 'bg-brand-600 text-white'
                            : 'bg-zinc-100 dark:bg-zinc-800'
                      }`}
                    >
                      {m.direction === 'INTERNAL' && <p className="mb-1 text-xs font-medium text-amber-800 dark:text-amber-300">Internal note</p>}
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      <p className={`mt-1 text-right text-[11px] ${mine && m.direction !== 'INTERNAL' ? 'text-white/80' : 'text-zinc-500'}`}>
                        {formatDateTime(m.createdAt, timeZone)}
                        {m.direction === 'OUTBOUND' && ` · ${STATUS_LABEL[m.status] ?? m.status.toLowerCase()}`}
                      </p>
                      {m.status === 'FAILED' && m.error && <p className="mt-1 text-xs font-medium text-red-200">⚠ {m.error}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
            {error && (
              <div className="px-4">
                <Alert>{error}</Alert>
              </div>
            )}
            {can.reply && (
              <form onSubmit={onSend} className="border-t border-zinc-100 p-3 dark:border-zinc-800">
                <textarea
                  name="body"
                  rows={3}
                  maxLength={20_000}
                  aria-label={internal ? 'Internal note' : 'Reply'}
                  placeholder={internal ? 'Note for your team (not sent to the customer)…' : `Reply to ${selected.lead.fullName}…`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
                  }}
                  className={`w-full rounded-md border px-3 py-2 text-sm dark:bg-zinc-900 ${
                    internal ? 'border-amber-300 bg-amber-50/50 dark:border-amber-800' : 'border-zinc-300 bg-white dark:border-zinc-700'
                  }`}
                />
                <div className="mt-2 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note
                  </label>
                  <Button type="submit" disabled={busy}>
                    {internal ? 'Add note' : 'Send'}
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
      </Card>

      {/* Context */}
      {selected && (
        <Card className="hidden min-h-0 space-y-4 overflow-y-auto p-4 lg:block">
          <div>
            <p className="text-xs text-zinc-500">Lead</p>
            <Link href={`/leads/${selected.lead.id}`} className="font-medium text-brand-600 hover:underline">
              {selected.lead.fullName}
            </Link>
            <p className="text-xs text-zinc-500">{selected.lead.email}</p>
            <p className="text-xs text-zinc-500">{selected.lead.phone}</p>
          </div>
          <div>
            <label htmlFor="assignee" className="text-xs text-zinc-500">
              Assigned to
            </label>
            {can.assign ? (
              <Select
                id="assignee"
                value={selected.assignee?.id ?? ''}
                disabled={busy}
                onChange={(e) => run(() => api(`/conversations/${selected.id}`, { method: 'PATCH', body: { assignedUserId: e.target.value || null } }))}
                className="mt-1 h-8"
              >
                <option value="">Nobody</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="mt-1 text-sm">{selected.assignee?.fullName ?? 'Nobody'}</p>
            )}
          </div>
          {can.reply && (
            <Button
              variant="secondary"
              className="w-full"
              disabled={busy}
              onClick={() =>
                run(() => api(`/conversations/${selected.id}`, { method: 'PATCH', body: { status: selected.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED' } }))
              }
            >
              {selected.status === 'RESOLVED' ? 'Reopen' : 'Mark resolved'}
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}
