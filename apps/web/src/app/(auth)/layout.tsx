import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <span className="grid size-8 place-items-center rounded-md bg-brand-600 font-semibold text-white">L</span>
          <span className="text-lg font-semibold tracking-tight">Leadora AI</span>
        </div>
        {children}
      </div>
    </main>
  );
}
