import Link from 'next/link';
import { Card } from './ui';

export function StatTile({ label, value, sub, href, alert }: { label: string; value: string; sub?: string; href?: string; alert?: boolean }) {
  const body = (
    <Card className={`h-full p-4 ${href ? 'transition-colors hover:border-brand-500' : ''}`}>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && (
        <p className={`mt-0.5 text-xs ${alert ? 'font-medium text-red-700 dark:text-red-400' : 'text-zinc-500'}`}>
          {alert && <span aria-hidden>⚠ </span>}
          {sub}
        </p>
      )}
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
