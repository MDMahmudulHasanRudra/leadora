'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, formatDateTime, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';

export interface ImportSummary {
  id: string;
  fileName: string;
  status: 'UPLOADED' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  rowCount: number;
  processedRows: number;
  imported: number;
  duplicates: number;
  invalid: number;
  failed: number;
  errorMessage: string | null;
  createdAt: string;
}

interface ImportDetail extends ImportSummary {
  errors: { row: number; code: string; field?: string; message: string; existingLeadId?: string }[];
}

interface Uploaded {
  id: string;
  fileName: string;
  headers: string[];
  rowCount: number;
  sample: string[][];
  suggestedMapping: Record<string, string>;
}

const FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: 'fullName', label: 'Name', required: true },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'companyName', label: 'Company' },
  { key: 'jobTitle', label: 'Job title' },
  { key: 'location', label: 'Location' },
  { key: 'industry', label: 'Industry' },
  { key: 'priority', label: 'Priority' },
  { key: 'tags', label: 'Tags' },
  { key: 'notes', label: 'Notes' },
];

const DONE = new Set(['COMPLETED', 'FAILED']);

async function uploadFile(file: File): Promise<Uploaded> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/v1/lead-imports', { method: 'POST', body: form, credentials: 'same-origin' });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 413) throw new ApiError(413, 'FILE_TOO_LARGE', 'The file is larger than 5 MB.');
    throw new ApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? 'Upload failed');
  }
  return json as Uploaded;
}

function StatusBadge({ status }: { status: ImportSummary['status'] }) {
  const tone = status === 'COMPLETED' ? 'green' : status === 'FAILED' ? 'red' : 'brand';
  return <Badge tone={tone}>{status.toLowerCase()}</Badge>;
}

export function ImportWizard({
  initialImportId,
  recent,
  owners,
  currentUserId,
  timeZone,
}: {
  initialImportId?: string;
  recent: ImportSummary[];
  owners: { id: string; fullName: string }[] | null;
  currentUserId: string;
  timeZone: string;
}) {
  const router = useRouter();
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [owner, setOwner] = useState(currentUserId);
  const [importId, setImportId] = useState<string | undefined>(initialImportId);
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!importId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const d = await api<ImportDetail>(`/lead-imports/${importId}`);
        if (stop) return;
        setDetail(d);
        if (!DONE.has(d.status)) timer = setTimeout(poll, 1500);
        else router.refresh();
      } catch (err) {
        if (!stop) setError(err instanceof ApiError ? err.message : 'Could not load the import');
      }
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [importId, router]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const u = await uploadFile(file);
      setUploaded(u);
      setMapping(u.suggestedMapping);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
      e.target.value = '';
    } finally {
      setBusy(false);
    }
  }

  async function onStart() {
    if (!uploaded) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)) };
      if (owners) body.ownerUserId = owner || null;
      await api(`/lead-imports/${uploaded.id}/start`, { method: 'POST', body });
      setImportId(uploaded.id);
      setUploaded(null);
    } catch (err) {
      setError(err instanceof ApiError ? (err.details[0]?.message ?? err.message) : 'Could not start the import');
    } finally {
      setBusy(false);
    }
  }

  const mappedOk = !!mapping.fullName && (!!mapping.email || !!mapping.phone);

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}

      {!uploaded && !importId && (
        <Card className="p-6">
          <label htmlFor="csv" className="block text-sm font-medium">
            1. Choose a CSV file
          </label>
          <p className="mt-1 text-sm text-zinc-500">The first row must contain column names. Each lead needs a name and an email or phone.</p>
          <input
            id="csv"
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            disabled={busy}
            className="mt-4 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-500"
          />
          {busy && <p className="mt-3 text-sm text-zinc-500">Reading file…</p>}
        </Card>
      )}

      {uploaded && (
        <Card className="space-y-5 p-6">
          <div>
            <h2 className="font-medium">2. Match columns</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {uploaded.fileName} · {uploaded.rowCount.toLocaleString()} rows. We pre-selected the columns we recognized.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="whitespace-nowrap">
                  {f.label}
                  {f.required && <span className="text-red-600"> *</span>}
                </span>
                <Select
                  aria-label={`Column for ${f.label}`}
                  value={mapping[f.key] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                  className="h-8 w-full max-w-48 min-w-0"
                >
                  <option value="">Don’t import</option>
                  {uploaded.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
          {owners && (
            <label className="flex items-center gap-3 text-sm">
              <span>Assign imported leads to</span>
              <Select value={owner} onChange={(e) => setOwner(e.target.value)} className="h-8 w-56" aria-label="Owner for imported leads">
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.id === currentUserId ? `${o.fullName} (me)` : o.fullName}
                  </option>
                ))}
                <option value="">Nobody (unassigned)</option>
              </Select>
            </label>
          )}
          <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 text-left dark:bg-zinc-800/50">
                <tr>
                  {uploaded.headers.map((h) => (
                    <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {uploaded.sample.map((row, i) => (
                  <tr key={i}>
                    {uploaded.headers.map((h, j) => (
                      <td key={h} className="max-w-48 truncate px-3 py-2 text-zinc-600 dark:text-zinc-400">
                        {row[j]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!mappedOk && <p className="text-sm text-amber-700 dark:text-amber-400">Choose a column for Name, and one for Email or Phone.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setUploaded(null)} disabled={busy}>
              Choose another file
            </Button>
            <Button onClick={onStart} disabled={!mappedOk || busy}>
              {busy ? 'Starting…' : `Import ${uploaded.rowCount.toLocaleString()} row${uploaded.rowCount === 1 ? '' : 's'}`}
            </Button>
          </div>
        </Card>
      )}

      {importId && detail && (
        <Card className="space-y-5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">{detail.fileName}</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {DONE.has(detail.status)
                  ? 'Import finished.'
                  : `Processing ${detail.processedRows.toLocaleString()} of ${detail.rowCount.toLocaleString()} rows…`}
              </p>
            </div>
            <StatusBadge status={detail.status} />
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={detail.rowCount}
            aria-valuenow={detail.processedRows}
          >
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${detail.rowCount ? (detail.processedRows / detail.rowCount) * 100 : 0}%` }} />
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Imported', detail.imported, 'text-emerald-600'],
              ['Duplicates', detail.duplicates, 'text-amber-600'],
              ['Invalid', detail.invalid, 'text-red-600'],
              ['Failed', detail.failed, 'text-red-600'],
            ].map(([label, value, color]) => (
              <div key={label as string} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <dt className="text-xs text-zinc-500">{label}</dt>
                <dd className={`text-xl font-semibold tabular-nums ${value ? color : ''}`}>{(value as number).toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          {detail.errorMessage && <Alert>{detail.errorMessage}</Alert>}
          {detail.errors.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">Rows that were not imported</h3>
                <a href={`/api/v1/lead-imports/${detail.id}/errors.csv`} className="text-sm text-brand-600 hover:underline">
                  Download error report
                </a>
              </div>
              <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
                {detail.errors.map((e) => (
                  <li key={e.row} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                    <span>
                      <span className="text-zinc-500 tabular-nums">Row {e.row}</span> · {e.field ? `${e.field}: ` : ''}
                      {e.message}
                    </span>
                    {e.existingLeadId && (
                      <Link href={`/leads/${e.existingLeadId}`} className="text-brand-600 hover:underline">
                        Existing lead
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {DONE.has(detail.status) && (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => router.push('/leads/import')}>
                Import another file
              </Button>
              <Button onClick={() => router.push('/leads')}>View leads</Button>
            </div>
          )}
        </Card>
      )}

      {recent.length > 0 && !uploaded && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-zinc-500">Recent imports</h2>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3">
                      <Link href={`/leads/import?id=${r.id}`} className="font-medium hover:text-brand-600 hover:underline">
                        {r.fileName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-zinc-500 tabular-nums">
                      {r.imported.toLocaleString()} of {r.rowCount.toLocaleString()} imported
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-500">{formatDateTime(r.createdAt, timeZone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
    </div>
  );
}
