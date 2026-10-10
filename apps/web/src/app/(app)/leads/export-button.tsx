'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';

interface ExportJob {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  rowCount: number | null;
  error: string | null;
  downloadable: boolean;
}

const DEFAULT_FIELDS = ['fullName', 'email', 'phone', 'companyName', 'stage', 'source', 'owner', 'score', 'tags', 'createdAt'];

/** Spec §44: exports what the list currently shows (same filters), as a background job. */
export function ExportButton({ filters }: { filters: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<{ key: string; label: string }[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set(DEFAULT_FIELDS));
  const [format, setFormat] = useState<'CSV' | 'XLSX'>('XLSX');
  const [job, setJob] = useState<ExportJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && fields.length === 0) void api<{ items: { key: string; label: string }[] }>('/exports/fields').then((r) => setFields(r.items));
  }, [open, fields.length]);

  // Poll until the worker finishes.
  useEffect(() => {
    if (!job || job.status === 'SUCCEEDED' || job.status === 'FAILED') return;
    const timer = setInterval(async () => setJob(await api<ExportJob>(`/exports/${job.id}`)), 1500);
    return () => clearInterval(timer);
  }, [job]);

  async function start() {
    setError(null);
    try {
      const { cursor: _c, ...rest } = filters;
      setJob(await api<ExportJob>('/exports', { method: 'POST', body: { entity: 'leads', format, fields: fields.map((f) => f.key).filter((k) => chosen.has(k)), filters: rest } }));
    } catch (err) {
      setError(err instanceof ApiError ? (err.details[0]?.message ?? err.message) : 'Could not start the export');
    }
  }

  return (
    <div className="relative">
      <Button variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        Export
      </Button>
      {open && (
        <Card className="absolute right-0 z-20 mt-2 w-80 space-y-3 p-4 shadow-lg">
          <p className="text-xs text-zinc-500">Exports the leads matching the current filters.</p>
          {error && <Alert>{error}</Alert>}
          <Select aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value as 'CSV' | 'XLSX')}>
            <option value="XLSX">Excel (.xlsx)</option>
            <option value="CSV">CSV</option>
          </Select>
          <fieldset className="max-h-48 space-y-1 overflow-y-auto">
            <legend className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">Columns</legend>
            {fields.map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.has(f.key)}
                  onChange={(e) =>
                    setChosen((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(f.key);
                      else next.delete(f.key);
                      return next;
                    })
                  }
                  className="size-4 accent-brand-600"
                />
                {f.label}
              </label>
            ))}
          </fieldset>
          {job ? (
            job.status === 'SUCCEEDED' ? (
              <a href={`/api/v1/exports/${job.id}/download`} className="block rounded-md bg-brand-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-brand-500">
                Download {job.rowCount} {job.rowCount === 1 ? 'lead' : 'leads'}
              </a>
            ) : job.status === 'FAILED' ? (
              <Alert>{job.error ?? 'The export failed'}</Alert>
            ) : (
              <p className="text-sm text-zinc-500">Preparing your file…</p>
            )
          ) : (
            <Button className="w-full" disabled={chosen.size === 0 || fields.length === 0} onClick={start}>
              Export
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}
