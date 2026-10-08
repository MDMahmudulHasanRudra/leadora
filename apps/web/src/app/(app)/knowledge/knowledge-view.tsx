'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, formatDateTime, Input, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import type { KbCollection, KbDocument } from '@/lib/types';
import { AskPanel } from './ask-panel';

const STATUS: Record<KbDocument['status'], { label: string; tone: 'neutral' | 'green' | 'red' | 'brand' }> = {
  UPLOADED: { label: 'queued', tone: 'neutral' },
  PROCESSING: { label: 'processing', tone: 'brand' },
  INDEXED: { label: 'indexed', tone: 'green' },
  FAILED: { label: 'failed', tone: 'red' },
  OUTDATED: { label: 'outdated', tone: 'neutral' },
};

const size = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? (err.details[0]?.message ?? err.message) : fallback);

/** multipart upload; the JSON api() helper can't send files. */
async function uploadFile(collectionId: string, file: File) {
  const form = new FormData();
  form.set('collectionId', collectionId);
  form.set('file', file);
  const res = await fetch('/api/v1/kb/documents/upload', { method: 'POST', body: form, credentials: 'same-origin' });
  if (res.status === 413) throw new ApiError(413, 'FILE_TOO_LARGE', 'The file is too large');
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? 'Upload failed', json?.error?.details);
  return json as KbDocument;
}

function AddSources({ collectionId, onDone }: { collectionId: string; onDone: () => void }) {
  const [tab, setTab] = useState<'file' | 'text' | 'url'>('file');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, form: HTMLFormElement) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      form.reset();
      onDone();
    } catch (err) {
      setError(errorText(err, 'Could not add the source'));
    } finally {
      setBusy(false);
    }
  }

  const onFile = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const files = (e.currentTarget.elements.namedItem('file') as HTMLInputElement).files;
    if (!files?.length) return;
    // One request per file so one bad file doesn't block the rest.
    void run(async () => {
      for (const f of Array.from(files)) await uploadFile(collectionId, f);
    }, e.currentTarget);
  };
  const onText = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    void run(() => api('/kb/documents/text', { method: 'POST', body: { collectionId, title: d.get('title'), text: d.get('text') } }), e.currentTarget);
  };
  const onUrl = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    void run(() => api('/kb/documents/url', { method: 'POST', body: { collectionId, url: d.get('url'), title: String(d.get('utitle') ?? '') || undefined } }), e.currentTarget);
  };

  const tabClass = (t: string) =>
    `rounded-md px-2.5 py-1 text-xs font-medium ${tab === t ? 'bg-brand-50 text-brand-600 dark:bg-zinc-800 dark:text-white' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Add sources</h3>
        <div className="flex gap-1" role="tablist">
          {(['file', 'text', 'url'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tabClass(t)} onClick={() => setTab(t)}>
              {t === 'file' ? 'Upload' : t === 'text' ? 'Paste text' : 'Web page'}
            </button>
          ))}
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {tab === 'file' && (
        <form onSubmit={onFile} className="flex flex-wrap items-center gap-2">
          <input name="file" type="file" multiple required accept=".pdf,.docx,.txt,.md,.markdown,.csv" aria-label="Files" className="min-w-0 flex-1 text-sm" />
          <Button type="submit" disabled={busy}>
            {busy ? 'Uploading…' : 'Upload'}
          </Button>
          <p className="w-full text-xs text-zinc-500">PDF, Word (.docx), text, Markdown or CSV.</p>
        </form>
      )}
      {tab === 'text' && (
        <form onSubmit={onText} className="space-y-2">
          <Input name="title" required maxLength={200} placeholder="Title, e.g. Return policy" aria-label="Title" />
          <textarea
            name="text"
            required
            minLength={10}
            rows={6}
            aria-label="Text"
            placeholder="Paste the text the AI should know…"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              Add text
            </Button>
          </div>
        </form>
      )}
      {tab === 'url' && (
        <form onSubmit={onUrl} className="space-y-2">
          <Input name="url" type="url" required placeholder="https://yourcompany.com/pricing" aria-label="Page URL" />
          <Input name="utitle" maxLength={200} placeholder="Title (optional — the page title is used)" aria-label="Title" />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-zinc-500">Public pages only. Re-index to refresh the content.</p>
            <Button type="submit" disabled={busy}>
              Import page
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function NewCollection({ teams, onCreated }: { teams: { id: string; name: string }[]; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState<'ORGANIZATION' | 'TEAMS'>('ORGANIZATION');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setError(null);
    try {
      const c = await api<KbCollection>('/kb/collections', {
        method: 'POST',
        body: { name: d.get('name'), description: String(d.get('description') ?? '') || null, visibility, teamIds: d.getAll('teamIds') },
      });
      setOpen(false);
      onCreated(c.id);
    } catch (err) {
      setError(errorText(err, 'Could not create the collection'));
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" className="w-full justify-start text-xs" onClick={() => setOpen(true)}>
        + New collection
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3 border-t border-zinc-100 p-3 dark:border-zinc-800">
      {error && <Alert>{error}</Alert>}
      <Field label="Name" htmlFor="kb-name">
        <Input id="kb-name" name="name" required maxLength={100} />
      </Field>
      <Field label="Description" htmlFor="kb-desc">
        <Input id="kb-desc" name="description" maxLength={500} />
      </Field>
      <Field label="Who can see it" htmlFor="kb-vis">
        <Select id="kb-vis" value={visibility} onChange={(e) => setVisibility(e.target.value as 'ORGANIZATION' | 'TEAMS')}>
          <option value="ORGANIZATION">Everyone in the organization</option>
          <option value="TEAMS" disabled={teams.length === 0}>
            Only selected teams
          </option>
        </Select>
      </Field>
      {visibility === 'TEAMS' && (
        <fieldset className="space-y-1">
          <legend className="text-xs text-zinc-500">Teams</legend>
          {teams.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="teamIds" value={t.id} className="size-4 accent-brand-600" /> {t.name}
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit">Create</Button>
      </div>
    </form>
  );
}

export function KnowledgeView({
  collections,
  selected,
  documents,
  teams,
  timeZone,
  can,
}: {
  collections: KbCollection[];
  selected: KbCollection | null;
  documents: KbDocument[];
  teams: { id: string; name: string }[];
  timeZone: string;
  can: { manage: boolean; ask: boolean; configure: boolean };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = documents.some((d) => d.status === 'UPLOADED' || d.status === 'PROCESSING');

  // Indexing runs in the worker; refresh until every document has settled.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [pending, router]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(errorText(err, 'Something went wrong'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
      <Card className="h-fit overflow-hidden">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {collections.length === 0 && <li className="p-4 text-sm text-zinc-500">No collections yet.</li>}
          {collections.map((c) => (
            <li key={c.id}>
              <Link
                href={`/knowledge?c=${c.id}`}
                aria-current={selected?.id === c.id ? 'page' : undefined}
                className={`block px-3 py-2.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 ${selected?.id === c.id ? 'bg-brand-50 dark:bg-zinc-800' : ''}`}
              >
                <span className="font-medium">{c.name}</span>
                <span className="block text-xs text-zinc-500">
                  {c.documentCount} {c.documentCount === 1 ? 'document' : 'documents'}
                  {c.visibility === 'TEAMS' && ' · teams only'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {can.manage && <NewCollection teams={teams} onCreated={(id) => router.push(`/knowledge?c=${id}`)} />}
      </Card>

      <div className="min-w-0 space-y-6">
        {can.ask && collections.length > 0 && <AskPanel canConfigure={can.configure} />}
        {selected && (
          <section aria-labelledby="docs" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="docs" className="font-medium">
                {selected.name}
              </h2>
              {selected.description && <p className="text-sm text-zinc-500">{selected.description}</p>}
            </div>
            {error && <Alert>{error}</Alert>}
            {can.manage && <AddSources collectionId={selected.id} onDone={() => router.refresh()} />}
            <Card className="overflow-x-auto">
              {documents.length === 0 ? (
                <p className="p-8 text-center text-sm text-zinc-500">No documents in this collection yet.</p>
              ) : (
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="border-b border-zinc-100 text-left text-xs text-zinc-500 dark:border-zinc-800">
                    <tr>
                      <th className="px-4 py-2 font-medium">Document</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Added</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {documents.map((d) => (
                      <tr key={d.id} className="align-top">
                        <td className="px-4 py-2.5">
                          <p className="font-medium">{d.title}</p>
                          <p className="text-xs text-zinc-500">
                            {d.sourceType === 'URL' ? (
                              <a href={d.sourceUrl ?? '#'} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                                {d.sourceUrl}
                              </a>
                            ) : (
                              <>
                                {d.fileName ?? 'Pasted text'} · {size(d.sizeBytes)}
                              </>
                            )}
                            {d.version > 1 && ` · v${d.version}`}
                            {d.status === 'INDEXED' && ` · ${d.chunkCount} chunks`}
                          </p>
                          {d.status === 'FAILED' && d.error && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{d.error}</p>}
                          {d.status === 'OUTDATED' && <p className="mt-1 text-xs text-zinc-500">The embedding model changed. Re-index to search it again.</p>}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-zinc-500">{formatDateTime(d.createdAt, timeZone)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-1">
                            {d.sizeBytes > 0 && (
                              <a href={`/api/v1/kb/documents/${d.id}/source`} className="rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
                                Source
                              </a>
                            )}
                            {can.manage && (
                              <>
                                <Button
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  disabled={busyId === d.id || d.status === 'PROCESSING'}
                                  onClick={() => act(d.id, () => api(`/kb/documents/${d.id}/reindex`, { method: 'POST' }))}
                                >
                                  Re-index
                                </Button>
                                <Button
                                  variant="ghost"
                                  className="h-7 px-2 text-xs text-red-700 dark:text-red-400"
                                  disabled={busyId === d.id}
                                  onClick={() => confirm(`Delete “${d.title}”? This removes the file and its search index.`) && act(d.id, () => api(`/kb/documents/${d.id}`, { method: 'DELETE' }))}
                                >
                                  Delete
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}
