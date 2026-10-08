'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { Alert, Button, Card, Input } from '@/components/ui';
import { explainAiError } from '@/lib/ai';
import { api } from '@/lib/api-client';
import type { KbCitation } from '@/lib/types';

interface Answer {
  answer: string;
  citations: KbCitation[];
  insufficientEvidence: boolean;
}

interface Hit {
  chunkId: string;
  documentTitle: string;
  page: number | null;
  section: string | null;
  content: string;
  similarity: number | null;
}

const where = (c: { page: number | null; section: string | null }) => [c.page ? `page ${c.page}` : null, c.section].filter(Boolean).join(' · ');

/** Spec §100 "Test retrieval" plus the grounded answer (spec §37) people actually want. */
export function AskPanel({ canConfigure }: { canConfigure: boolean }) {
  const [mode, setMode] = useState<'ask' | 'search'>('ask');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; settingsLink: boolean } | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get('q') ?? '').trim();
    if (q.length < 3) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'ask') {
        setHits(null);
        setAnswer(await api<Answer>('/kb/ask', { method: 'POST', body: { question: q } }));
      } else {
        setAnswer(null);
        setHits((await api<{ items: Hit[] }>('/kb/search', { method: 'POST', body: { query: q } })).items);
      }
    } catch (err) {
      setError(explainAiError(err, canConfigure, 'The knowledge base'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <form onSubmit={onSubmit} className="flex flex-wrap gap-2">
        <select
          aria-label="Mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as 'ask' | 'search')}
          className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="ask">Ask</option>
          <option value="search">Test retrieval</option>
        </select>
        <Input name="q" required minLength={3} maxLength={1000} placeholder={mode === 'ask' ? 'e.g. What discount do bulk orders get?' : 'Words to search for'} aria-label="Question" className="min-w-48 flex-1" />
        <Button type="submit" disabled={busy}>
          {busy ? 'Searching…' : mode === 'ask' ? 'Ask' : 'Search'}
        </Button>
      </form>
      {error && (
        <Alert>
          {error.message}{' '}
          {error.settingsLink && (
            <Link href="/settings/ai" className="font-medium underline">
              Open AI settings
            </Link>
          )}
        </Alert>
      )}
      {answer && (
        <div className="space-y-3">
          <p className={`whitespace-pre-wrap text-sm ${answer.insufficientEvidence ? 'text-zinc-600 dark:text-zinc-400' : ''}`}>{answer.answer}</p>
          {answer.citations.length > 0 && (
            <ol className="space-y-1.5">
              {answer.citations.map((c) => (
                <li key={c.id} className="rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                  <p className="font-medium">
                    [{c.id}] {c.title}
                    {where(c) && <span className="font-normal text-zinc-500"> · {where(c)}</span>}{' '}
                    <a href={c.sourceUrl ?? `/api/v1/kb/documents/${c.documentId}/source`} target="_blank" rel="noopener noreferrer" className="font-normal text-brand-600 hover:underline">
                      open source
                    </a>
                  </p>
                  <p className="mt-0.5 line-clamp-3 text-zinc-600 dark:text-zinc-400">{c.snippet}</p>
                </li>
              ))}
            </ol>
          )}
          <p className="text-[11px] text-zinc-500">Answered only from your documents. Check the sources before relying on it.</p>
        </div>
      )}
      {hits && (
        <ol className="space-y-1.5">
          {hits.length === 0 && <li className="text-sm text-zinc-500">No matching passages.</li>}
          {hits.map((h, i) => (
            <li key={h.chunkId} className="rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
              <p className="font-medium">
                {i + 1}. {h.documentTitle}
                {where(h) && <span className="font-normal text-zinc-500"> · {where(h)}</span>}
                {h.similarity !== null && <span className="font-normal text-zinc-500 tabular-nums"> · similarity {h.similarity.toFixed(2)}</span>}
              </p>
              <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{h.content}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
