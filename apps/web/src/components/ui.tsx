import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-500',
        variant === 'secondary' &&
          'border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800',
        variant === 'danger' && 'border border-red-200 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950',
        variant === 'ghost' && 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
        className,
      )}
    />
  );
}

const fieldBase =
  'h-9 w-full rounded-md border bg-white px-3 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:bg-zinc-900';

export function Input({ invalid, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={cx(fieldBase, invalid ? 'border-red-400' : 'border-zinc-300 dark:border-zinc-700', className)}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(fieldBase, 'border-zinc-300 pr-8 dark:border-zinc-700', className)} />;
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400" id={`${htmlFor}-error`}>
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-zinc-500">{hint}</p>
      )}
    </div>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {children}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900', className)}>
      {children}
    </section>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'green' | 'red' | 'brand'; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
        tone === 'green' && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
        tone === 'red' && 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
        tone === 'brand' && 'bg-brand-50 text-brand-600 dark:bg-zinc-800 dark:text-white',
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Always pass the viewer's timezone: server and browser must render identical text to hydrate. */
export function formatDateTime(iso: string | null, timeZone: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
}
