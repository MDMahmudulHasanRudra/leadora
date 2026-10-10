'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api-client';

export function RefreshInsights() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200"
      onClick={async () => {
        setBusy(true);
        await api('/analytics/insights/refresh', { method: 'POST' }).catch(() => undefined);
        router.refresh();
        setBusy(false);
      }}
    >
      {busy ? 'Refreshing…' : 'Refresh'}
    </button>
  );
}
