import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Leadora AI',
  description: 'AI-powered lead generation and sales intelligence platform',
};

const NAV = [
  { label: 'Dashboard', phase: 0 },
  { label: 'Leads', phase: 1 },
  { label: 'Inbox', phase: 2 },
  { label: 'Pipeline', phase: 1 },
  { label: 'Contacts', phase: 1 },
  { label: 'Companies', phase: 1 },
  { label: 'Tasks', phase: 1 },
  { label: 'Knowledge Base', phase: 5 },
  { label: 'AI Assistant', phase: 4 },
  { label: 'Automations', phase: 6 },
  { label: 'Analytics', phase: 8 },
  { label: 'Team', phase: 1 },
  { label: 'Integrations', phase: 7 },
  { label: 'Settings', phase: 1 },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col md:flex-row">
          <aside className="border-b border-zinc-200 bg-white px-4 py-4 md:w-60 md:shrink-0 md:border-r md:border-b-0 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-4 flex items-center gap-2 px-2">
              <span className="grid size-7 place-items-center rounded-md bg-brand-600 text-sm font-semibold text-white">L</span>
              <span className="font-semibold tracking-tight">Leadora AI</span>
            </div>
            <nav className="flex gap-1 overflow-x-auto md:flex-col">
              {NAV.map((item) => {
                const active = item.phase === 0;
                return (
                  <span
                    key={item.label}
                    aria-disabled={!active}
                    title={active ? undefined : `Coming in Phase ${item.phase}`}
                    className={
                      active
                        ? 'rounded-md bg-brand-50 px-2 py-1.5 text-sm font-medium whitespace-nowrap text-brand-600 dark:bg-zinc-800 dark:text-white'
                        : 'cursor-not-allowed rounded-md px-2 py-1.5 text-sm whitespace-nowrap text-zinc-400 dark:text-zinc-500'
                    }
                  >
                    {item.label}
                  </span>
                );
              })}
            </nav>
          </aside>
          <main className="flex-1 px-4 py-6 md:px-10 md:py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
