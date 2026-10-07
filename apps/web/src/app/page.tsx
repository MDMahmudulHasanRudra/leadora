export const dynamic = 'force-dynamic';

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

function StatusDot({ up }: { up: boolean }) {
  return <span className={`inline-block size-2 rounded-full ${up ? 'bg-emerald-500' : 'bg-red-500'}`} aria-hidden />;
}

export default async function DashboardPage() {
  const readiness = await getReadiness();
  const services: Array<[string, boolean, string]> = [
    ['API', readiness !== null, readiness ? 'reachable' : 'unreachable'],
    ...Object.entries(readiness?.checks ?? {}).map(
      ([name, c]): [string, boolean, string] => [
        name === 'postgres' ? 'PostgreSQL' : name === 'valkey' ? 'Valkey' : name,
        c.status === 'up',
        c.status === 'up' ? `${c.latencyMs} ms` : (c.error ?? 'down'),
      ],
    ),
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Phase 0 foundation. CRM, communication and AI modules arrive in later phases.
      </p>

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-medium text-zinc-500">System status</h2>
        <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
          {services.map(([name, up, detail]) => (
            <li key={name} className="flex items-center justify-between py-2.5 text-sm">
              <span className="flex items-center gap-2">
                <StatusDot up={up} />
                {name}
              </span>
              <span className="tabular-nums text-zinc-500">{detail}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
