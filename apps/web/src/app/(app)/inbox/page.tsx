import { redirect } from 'next/navigation';
import { apiGet, getIdentity, requireData } from '@/lib/api-server';
import type { ConversationAnalysis, Page, UserRow } from '@/lib/types';
import { InboxView, type ConversationItem, type MessageItem } from './inbox-view';

export const dynamic = 'force-dynamic';

const VIEWS = ['all', 'mine', 'unassigned', 'unread', 'waiting_agent', 'waiting_customer', 'resolved'] as const;

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ view?: string; c?: string }> }) {
  const identity = await getIdentity();
  if (!identity) redirect('/login');
  if (!identity.permissions.includes('conversation.view')) redirect('/');

  const sp = await searchParams;
  const view = (VIEWS as readonly string[]).includes(sp.view ?? '') ? sp.view! : 'all';
  const can = (p: string) => identity.permissions.includes(p);

  const [list, users] = await Promise.all([
    requireData<Page<ConversationItem>>(`/conversations?view=${view}`),
    can('user.view') ? requireData<Page<UserRow>>('/users') : Promise.resolve({ items: [] as UserRow[] }),
  ]);

  let selected: ConversationItem | null = null;
  let messages: MessageItem[] = [];
  let analysis: { result: ConversationAnalysis; createdAt: string } | null = null;
  if (sp.c && /^[0-9a-f-]{36}$/.test(sp.c)) {
    const [conv, msgs, ai] = await Promise.all([
      apiGet<ConversationItem>(`/conversations/${sp.c}`),
      apiGet<Page<MessageItem>>(`/conversations/${sp.c}/messages`),
      // 404 just means not analysed yet.
      apiGet<{ result: ConversationAnalysis; createdAt: string }>(`/ai/conversations/${sp.c}/analysis`),
    ]);
    selected = conv.data;
    messages = msgs.data?.items ?? [];
    analysis = ai.data;
  }

  return (
    <InboxView
      view={view}
      conversations={list.items}
      selected={selected}
      messages={messages}
      users={users.items.filter((u) => u.status === 'ACTIVE').map(({ id, fullName }) => ({ id, fullName }))}
      timeZone={identity.user.timezone}
      can={{ reply: can('conversation.reply'), assign: can('conversation.assign'), ai: can('ai.use'), aiConfigure: can('ai.configure') }}
      analysis={analysis}
    />
  );
}
