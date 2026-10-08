'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import type { ScoringSettings } from '@/lib/types';

export function ScoringForm({ settings }: { settings: ScoringSettings }) {
  const router = useRouter();
  const [rules, setRules] = useState(settings.rules);
  const [aiWeight, setAiWeight] = useState(settings.aiWeight);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const ruleWeight = 100 - aiWeight;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api('/scoring/settings', {
        method: 'PUT',
        body: {
          ruleWeight,
          aiWeight,
          hotThreshold: Number(data.get('hot')),
          warmThreshold: Number(data.get('warm')),
          rules: Object.fromEntries(rules.map((r) => [r.key, { enabled: r.enabled, points: r.points }])),
        },
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? (err.details[0]?.message ?? err.message) : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const update = (key: string, patch: Partial<{ enabled: boolean; points: number }>) =>
    setRules((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && <Alert>{error}</Alert>}

      <Card className="overflow-x-auto">
        <div className="p-5 pb-3">
          <h2 className="font-medium">Rules</h2>
          <p className="text-sm text-zinc-500">Points add up to the rule score (capped at 0–100). Negative points lower it.</p>
        </div>
        <table className="w-full min-w-[420px] text-sm">
          <thead className="border-y border-zinc-100 text-left text-xs text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-5 py-2 font-medium">On</th>
              <th className="py-2 font-medium">Signal</th>
              <th className="px-5 py-2 text-right font-medium">Points</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rules.map((r) => (
              <tr key={r.key} className={r.enabled ? '' : 'text-zinc-400'}>
                <td className="px-5 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Use rule: ${r.label}`}
                    checked={r.enabled}
                    onChange={(e) => update(r.key, { enabled: e.target.checked })}
                    className="size-4 accent-brand-600"
                  />
                </td>
                <td className="py-2">{r.label}</td>
                <td className="px-5 py-2">
                  <div className="ml-auto w-20">
                    <Input
                      type="number"
                      min={-100}
                      max={100}
                      step={1}
                      required
                      aria-label={`Points for ${r.label}`}
                      value={r.points}
                      onChange={(e) => update(r.key, { points: Number(e.target.value) })}
                      className="text-right tabular-nums"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="grid gap-6 p-5 sm:grid-cols-2">
        <div className="space-y-3">
          <h2 className="font-medium">Blend</h2>
          <label htmlFor="aiWeight" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            AI share of the final score: <span className="tabular-nums">{aiWeight}%</span>
          </label>
          <input
            id="aiWeight"
            type="range"
            min={0}
            max={100}
            step={5}
            value={aiWeight}
            onChange={(e) => setAiWeight(Number(e.target.value))}
            className="w-full accent-brand-600"
          />
          <p className="text-xs text-zinc-500">
            Rules {ruleWeight}% · AI {aiWeight}%. Leads without an AI analysis use the rule score alone. Set AI to 0% to score by rules only.
          </p>
        </div>
        <div className="space-y-3">
          <h2 className="font-medium">Temperature</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hot from" htmlFor="hot">
              <Input id="hot" name="hot" type="number" min={1} max={100} required defaultValue={settings.hotThreshold} />
            </Field>
            <Field label="Warm from" htmlFor="warm" hint="Below this is cold.">
              <Input id="warm" name="warm" type="number" min={1} max={100} required defaultValue={settings.warmThreshold} />
            </Field>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-sm text-emerald-700 dark:text-emerald-400">Saved — existing leads are being rescored</span>}
        <Button type="submit" disabled={busy}>
          Save scoring
        </Button>
      </div>
    </form>
  );
}
