'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import { type AiSettings, MODEL_PROFILES, type ModelPrice, type ModelProfile } from '@/lib/types';

const PROFILE_HINTS: Record<ModelProfile, string> = {
  fast: 'Cheap, quick tasks and the connection test.',
  balanced: 'Lead analysis and most everyday tasks.',
  reasoning: 'Harder multi-step work (later phases).',
  embedding: 'Knowledge-base search (Phase 5).',
};

type TestResult = { ok: true; model: string; latencyMs: number } | { ok: false; model: string; code: string; message: string };

export function AiSettingsForm({ settings }: { settings: AiSettings }) {
  const router = useRouter();
  const [models, setModels] = useState<Partial<Record<ModelProfile, string>>>(settings.models);
  const [prices, setPrices] = useState<Record<string, ModelPrice>>(settings.prices);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  const distinctModels = [...new Set(Object.values(models).filter((m): m is string => !!m?.trim()))];

  async function call(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? (err.details[0] ? `${err.details[0].path}: ${err.details[0].message}` : err.message) : 'Could not save');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const apiKey = String(data.get('apiKey') ?? '').trim();
    const budget = String(data.get('budget') ?? '').trim();
    const ok = await call(() =>
      api('/ai/settings', {
        method: 'PUT',
        body: {
          enabled: data.get('enabled') === 'on',
          provider: data.get('provider'),
          ...(apiKey ? { apiKey } : {}),
          models: Object.fromEntries(MODEL_PROFILES.map((p) => [p, (models[p] ?? '').trim()])),
          features: { leadAnalysis: data.get('leadAnalysis') === 'on' },
          monthlyBudgetUsd: budget === '' ? null : Number(budget),
          prices: Object.fromEntries(distinctModels.filter((m) => prices[m]).map((m) => [m, prices[m]!])),
        },
      }),
    );
    if (ok) {
      (form.elements.namedItem('apiKey') as HTMLInputElement).value = '';
      setSaved(true);
    }
  }

  async function onTest() {
    setTest(null);
    await call(async () => setTest(await api<TestResult>('/ai/settings/test', { method: 'POST' })));
  }

  const setPrice = (model: string, key: keyof ModelPrice, value: string) =>
    setPrices((p) => ({ ...p, [model]: { ...(p[model] ?? { input: 0, cachedInput: 0, output: 0 }), [key]: value === '' ? 0 : Number(value) } }));

  return (
    <form onSubmit={onSave} className="space-y-6">
      {!settings.platformEnabled && (
        <Alert>AI is switched off for this installation (ENABLE_AI=false). Settings can be saved, but no AI calls will run.</Alert>
      )}
      {error && <Alert>{error}</Alert>}

      <Card className="space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Provider</h2>
            <p className="text-sm text-zinc-500">Your organization’s own API key. It is encrypted at rest and never shown again.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="size-4 accent-brand-600" />
            AI enabled
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider" htmlFor="provider">
            <Select id="provider" name="provider" defaultValue={settings.provider}>
              <option value="openai">OpenAI</option>
            </Select>
          </Field>
          <Field
            label="API key"
            htmlFor="apiKey"
            hint={settings.hasApiKey ? `A key ending in ${settings.apiKeyLast4} is saved. Enter a new one to replace it.` : 'No key saved yet.'}
          >
            <Input
              id="apiKey"
              name="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={settings.hasApiKey ? `•••• ${settings.apiKeyLast4}` : 'sk-…'}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" disabled={busy || !settings.hasApiKey} onClick={onTest}>
            Test connection
          </Button>
          {settings.hasApiKey && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => confirm('Remove the saved API key? AI features will stop until a new key is added.') && call(() => api('/ai/settings', { method: 'PUT', body: { apiKey: '' } }))}
            >
              Remove key
            </Button>
          )}
          {test &&
            (test.ok ? (
              <Badge tone="green">
                Connected · {test.model} · {test.latencyMs} ms
              </Badge>
            ) : (
              <span role="status" className="text-sm text-red-700 dark:text-red-400">
                {test.message} ({test.code})
              </span>
            ))}
        </div>
      </Card>

      <Card className="space-y-5 p-5">
        <div>
          <h2 className="font-medium">Models</h2>
          <p className="text-sm text-zinc-500">Use your provider’s model IDs. Features pick a profile, so you can switch models without touching prompts.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {MODEL_PROFILES.map((p) => (
            <Field key={p} label={p.charAt(0).toUpperCase() + p.slice(1)} htmlFor={`model-${p}`} hint={PROFILE_HINTS[p]}>
              <Input id={`model-${p}`} value={models[p] ?? ''} maxLength={100} spellCheck={false} onChange={(e) => setModels((m) => ({ ...m, [p]: e.target.value }))} />
            </Field>
          ))}
        </div>
        {distinctModels.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium">Prices (USD per 1M tokens)</h3>
            <p className="mb-3 text-xs text-zinc-500">Used to estimate cost and enforce the monthly budget. Copy them from your provider’s pricing page.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-zinc-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Model</th>
                    <th className="py-1 pr-3 font-medium">Input</th>
                    <th className="py-1 pr-3 font-medium">Cached input</th>
                    <th className="py-1 font-medium">Output</th>
                  </tr>
                </thead>
                <tbody>
                  {distinctModels.map((m) => (
                    <tr key={m}>
                      <td className="py-1 pr-3 font-mono text-xs">{m}</td>
                      {(['input', 'cachedInput', 'output'] as const).map((k) => (
                        <td key={k} className="py-1 pr-3">
                          <div className="w-28">
                            <Input
                              type="number"
                              min={0}
                              step="0.001"
                              aria-label={`${m} ${k} price`}
                              value={prices[m]?.[k] ?? ''}
                              onChange={(e) => setPrice(m, k, e.target.value)}
                            />
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      <Card className="grid gap-5 p-5 sm:grid-cols-2">
        <div className="space-y-3">
          <h2 className="font-medium">Spending limit</h2>
          <Field
            label="Monthly budget (USD)"
            htmlFor="budget"
            hint={`Spent this month: $${settings.monthToDateSpendUsd.toFixed(4)}. Calls stop when the budget is used up. Leave empty for no limit.`}
          >
            <div className="w-40">
              <Input id="budget" name="budget" type="number" min={0} step="0.01" defaultValue={settings.monthlyBudgetUsd ?? ''} />
            </div>
          </Field>
        </div>
        <div className="space-y-3">
          <h2 className="font-medium">Features</h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="leadAnalysis" defaultChecked={settings.features.leadAnalysis !== false} className="mt-0.5 size-4 accent-brand-600" />
            <span>
              Lead analysis
              <span className="block text-xs text-zinc-500">Score a lead and recommend the next action, on demand from the lead page.</span>
            </span>
          </label>
          <p className="text-xs text-zinc-500">Conversation analysis, reply suggestions and AI search arrive in Phase 4; the knowledge base in Phase 5.</p>
        </div>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-sm text-emerald-700 dark:text-emerald-400">Saved</span>}
        <Button type="submit" disabled={busy}>
          Save AI settings
        </Button>
      </div>
    </form>
  );
}
