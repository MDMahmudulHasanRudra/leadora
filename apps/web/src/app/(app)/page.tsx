import { Card, PageHeader } from '@/components/ui';
import { getIdentity } from '@/lib/api-server';

type Check = { status: 'up' | 'down'; latencyMs: number; error?: string };
type Readiness = { status: 'ok' | 'error'; checks: Record<string, Check> };

async function getReadiness(): Promise<Readiness | null> {
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${base}/health/ready`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    return (await res.json()) as Readiness;
  } catch {
    return null;
  }
}

const LABELS: Record<string, string> = { postgres: 'PostgreSQL', valkey: 'Valkey' };

export default async function DashboardPage() {
  const [identity, readiness] = await Promise.all([getIdentity(), getReadiness()]);
  const services: Array<[string, boolean, string]> = [
    ['API', readiness !== null, readiness ? 'reachable' : 'unreachable'],
    ...Object.entries(readiness?.checks ?? {}).map(([name, c]): [string, boolean, string] => [
      LABELS[name] ?? name,
      c.status === 'up',
      c.status === 'up' ? `${c.latencyMs} ms` : (c.error ?? 'down'),
    ]),
  ];

  return (
    <>
      <PageHeader
        title={`Welcome, ${identity?.user.fullName.split(' ')[0] ?? 'there'}`}
        description="Leads, pipeline and AI insights arrive in the next phases."
      />
      <Card className="p-5">
        <h2 className="text-sm font-medium text-zinc-500">System status</h2>
        <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
          {services.map(([name, up, detail]) => (
            <li key={name} className="flex items-center justify-between py-2.5 text-sm">
              <span className="flex items-center gap-2">
                <span className={`inline-block size-2 rounded-full ${up ? 'bg-emerald-500' : 'bg-red-500'}`} aria-hidden />
                {name}
              </span>
              <span className="text-zinc-500 tabular-nums">{detail}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
