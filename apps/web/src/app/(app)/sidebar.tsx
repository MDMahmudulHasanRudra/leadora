'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { NotificationBell } from '@/components/notification-bell';
import { api } from '@/lib/api-client';
import type { Identity } from '@/lib/types';

type NavItem = { label: string; href?: string; permission?: string; phase?: number };

const SECTIONS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { label: 'Dashboard', href: '/' },
      { label: 'Leads', href: '/leads', permission: 'lead.view' },
      { label: 'Pipeline', href: '/pipeline', permission: 'lead.view' },
      { label: 'Follow-ups', href: '/followups', permission: 'followup.view' },
      { label: 'Tasks', href: '/tasks', permission: 'followup.view' },
      { label: 'Contacts', href: '/contacts', permission: 'lead.view' },
      { label: 'Companies', href: '/companies', permission: 'lead.view' },
      { label: 'Inbox', href: '/inbox', permission: 'conversation.view' },
      { label: 'Knowledge Base', phase: 5 },
      { label: 'AI Assistant', href: '/assistant', permission: 'ai.use' },
      { label: 'Automations', phase: 6 },
      { label: 'Analytics', phase: 8 },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { label: 'Users', href: '/users', permission: 'user.view' },
      { label: 'Teams', href: '/teams', permission: 'team.view' },
      { label: 'Audit log', href: '/audit', permission: 'audit.view' },
      { label: 'Custom fields', href: '/settings/fields', permission: 'settings.manage' },
      { label: 'Assignment rules', href: '/settings/assignment', permission: 'settings.manage' },
      { label: 'Lead scoring', href: '/settings/scoring', permission: 'settings.manage' },
      { label: 'Inboxes', href: '/settings/inboxes', permission: 'settings.manage' },
      { label: 'AI settings', href: '/settings/ai', permission: 'ai.configure' },
    ],
  },
];

export function Sidebar({ identity }: { identity: Identity }) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const can = (p?: string) => !p || identity.permissions.includes(p);

  async function signOut() {
    setSigningOut(true);
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <aside className="flex flex-col border-b border-zinc-200 bg-white px-3 py-4 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 px-2">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-brand-600 text-sm font-semibold text-white">L</span>
          <span className="font-semibold tracking-tight">Leadora AI</span>
        </div>
        <p className="mt-1 truncate text-xs text-zinc-500" title={identity.organization.name}>
          {identity.organization.name}
        </p>
      </div>

      <nav className="flex gap-4 overflow-x-auto md:flex-1 md:flex-col md:overflow-y-auto" aria-label="Main">
        {SECTIONS.map((section, i) => (
          <div key={i} className="flex gap-1 md:flex-col">
            {section.title && (
              <p className="hidden px-2 pt-2 pb-1 text-xs font-medium tracking-wide text-zinc-400 uppercase md:block">{section.title}</p>
            )}
            {section.items.filter((item) => can(item.permission)).map((item) => {
              if (!item.href) {
                return (
                  <span
                    key={item.label}
                    aria-disabled
                    title={`Coming in Phase ${item.phase}`}
                    className="cursor-not-allowed rounded-md px-2 py-1.5 text-sm whitespace-nowrap text-zinc-400 dark:text-zinc-600"
                  >
                    {item.label}
                  </span>
                );
              }
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={
                    active
                      ? 'rounded-md bg-brand-50 px-2 py-1.5 text-sm font-medium whitespace-nowrap text-brand-600 dark:bg-zinc-800 dark:text-white'
                      : 'rounded-md px-2 py-1.5 text-sm whitespace-nowrap text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-zinc-200 px-2 pt-4 dark:border-zinc-800">
        <NotificationBell />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{identity.user.fullName}</p>
          <p className="truncate text-xs text-zinc-500">{identity.user.role.toLowerCase()}</p>
        </div>
        <button
          onClick={signOut}
          disabled={signingOut}
          className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </aside>
  );
}
