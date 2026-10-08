'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Alert, Badge, Button, Card, formatDateTime, Input } from '@/components/ui';
import { explainAiError } from '@/lib/ai';
import { api } from '@/lib/api-client';
import { formatNumber, formatPercent } from '@/lib/format';

export interface HistoryItem {
  id: string;
  question: string;
  tool: string | null;
  status: 'ANSWERED' | 'DENIED' | 'UNSUPPORTED';
  resultCount: number | null;
  answer: string | null;
  createdAt: string;
}

type Row = Record<string, unknown>;
interface QueryResponse {
  status: HistoryItem['status'];
  question: string;
  plan: { tool: string; explanation: string };
  results: { kind: 'leads' | 'team' | 'sources' | 'followups' | 'conversations'; items: Row[] } | null;
  answer: string;
  highlights: string[];
}

// Spec §38's example questions, so people see what the assistant can do.
const EXAMPLES = [
  'Show hot leads with no follow-up in 24 hours',
  'Which sales agent has the best conversion rate this month?',
  'Which lead source produced the most revenue?',
  'Show leads asking about pricing but not converted',
  'What follow-ups are overdue?',
  'Which conversations need manager attention?',
];

const s = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

function Results({ results, timeZone }: { results: NonNullable<QueryResponse['results']>; timeZone: string }) {
  const date = (v: unknown) => (v ? formatDateTime(String(v), timeZone) : '—');
  const columns: Record<typeof results.kind, { label: string; cell: (r: Row) => ReactNode; numeric?: boolean }[]> = {
    leads: [
      { label: 'Lead', cell: (r) => <Link href={`/leads/${r.id}`} className="font-medium text-brand-600 hover:underline">{s(r.fullName)}</Link> },
      { label: 'Company', cell: (r) => s(r.companyName) },
      { label: 'Score', cell: (r) => `${s(r.score)}${r.temperature ? ` · ${String(r.temperature).toLowerCase()}` : ''}`, numeric: true },
      { label: 'Stage', cell: (r) => s(r.stage) },
      { label: 'Owner', cell: (r) => s(r.owner) },
      { label: 'Last contact', cell: (r) => date(r.lastContactedAt) },
    ],
    team: [
      { label: 'Person', cell: (r) => s(r.fullName) },
      { label: 'Leads', cell: (r) => formatNumber(Number(r.leads)), numeric: true },
      { label: 'Won', cell: (r) => formatNumber(Number(r.won)), numeric: true },
      { label: 'Conversion', cell: (r) => formatPercent(Number(r.conversionRate)), numeric: true },
    ],
    sources: [
      { label: 'Source', cell: (r) => s(r.name) },
      { label: 'Leads', cell: (r) => formatNumber(Number(r.leads)), numeric: true },
      { label: 'Won', cell: (r) => formatNumber(Number(r.won)), numeric: true },
      { label: 'Won value', cell: (r) => formatNumber(Number(r.wonValue)), numeric: true },
      { label: 'Conversion', cell: (r) => formatPercent(Number(r.conversionRate)), numeric: true },
    ],
    followups: [
      { label: 'When', cell: (r) => date(r.scheduledAt) },
      { label: 'Type', cell: (r) => s(r.type).toLowerCase() },
      { label: 'Lead', cell: (r) => <Link href={`/leads/${r.leadId}`} className="text-brand-600 hover:underline">{s(r.leadName)}</Link> },
      { label: 'Assignee', cell: (r) => s(r.assignee) },
    ],
    conversations: [
      { label: 'Customer', cell: (r) => <Link href={`/inbox?c=${r.id}`} className="text-brand-600 hover:underline">{s(r.leadName)}</Link> },
      { label: 'Subject', cell: (r) => s(r.subject) },
      { label: 'Why', cell: (r) => s(r.reason) },
      { label: 'Last message', cell: (r) => date(r.lastMessageAt) },
    ],
  };
  const cols = columns[results.kind];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="border-b border-zinc-100 text-left text-xs text-zinc-500 dark:border-zinc-800">
          <tr>
            {cols.map((c) => (
              <th key={c.label} className={`px-4 py-2 font-medium ${c.numeric ? 'text-right' : ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {results.items.map((r, i) => (
            <tr key={String(r.id ?? r.userId ?? r.name ?? i)}>
              {cols.map((c) => (
                <td key={c.label} className={`px-4 py-2 ${c.numeric ? 'text-right tabular-nums' : ''}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AssistantView({ history, timeZone, canConfigure }: { history: HistoryItem[]; timeZone: string; canConfigure: boolean }) {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; settingsLink: boolean } | null>(null);
  const [result, setResult] = useState<QueryResponse | null>(null);

  async function ask(q: string) {
    const text = q.trim();
    if (text.length < 3) return;
    setQuestion(text);
    setBusy(true);
    setError(null);
    try {
      setResult(await api<QueryResponse>('/ai/assistant/query', { method: 'POST', body: { question: text } }));
      router.refresh();
    } catch (err) {
      setError(explainAiError(err, canConfigure, 'AI search'));
    } finally {
      setBusy(false);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(question);
  };

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder="e.g. Show hot leads with no follow-up in 24 hours"
          aria-label="Ask a question"
          className="h-10"
        />
        <Button type="submit" className="h-10" disabled={busy || question.trim().length < 3}>
          {busy ? 'Thinking…' : 'Ask'}
        </Button>
      </form>

      {!result && !busy && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => ask(q)}
              className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:border-brand-500 hover:text-brand-600 dark:border-zinc-700 dark:text-zinc-300"
            >
              {q}
            </button>
          ))}
        </div>
      )}

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

      {result && (
        <Card>
          <div className="space-y-3 p-5">
            <p className="text-xs text-zinc-500">
              {result.question} · <span className="italic">{result.plan.explanation}</span>
            </p>
            <p className={result.status === 'ANSWERED' ? '' : 'text-zinc-600 dark:text-zinc-400'}>{result.answer}</p>
            {result.highlights.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {result.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            )}
          </div>
          {result.results && result.results.items.length > 0 && (
            <div className="border-t border-zinc-100 dark:border-zinc-800">
              <Results results={result.results} timeZone={timeZone} />
            </div>
          )}
          <p className="border-t border-zinc-100 px-5 py-2 text-[11px] text-zinc-500 dark:border-zinc-800">
            Read-only. The list comes straight from your CRM; the summary is AI-written and can be wrong.
          </p>
        </Card>
      )}

      {history.length > 0 && (
        <section aria-labelledby="recent">
          <h2 id="recent" className="mb-2 text-sm font-medium text-zinc-500">
            Recent questions
          </h2>
          <Card>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <button type="button" className="min-w-0 truncate text-left hover:text-brand-600" onClick={() => ask(h.question)} title="Ask again">
                    {h.question}
                  </button>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-zinc-500">
                    {h.status !== 'ANSWERED' ? <Badge>{h.status.toLowerCase()}</Badge> : `${h.resultCount ?? 0} results`}
                    <time dateTime={h.createdAt}>{formatDateTime(h.createdAt, timeZone)}</time>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
