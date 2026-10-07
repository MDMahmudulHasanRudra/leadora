'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';

export function SetupForm() {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await api('/auth/register', { method: 'POST', body: { ...Object.fromEntries(form), timezone } });
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'NETWORK', 'Could not reach the server. Please try again.'));
      setPending(false);
    }
  }

  const fieldError = (path: string) => error?.fieldError(path);

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && error.code !== 'VALIDATION_FAILED' && <Alert>{error.message}</Alert>}
      <Field label="Organization name" htmlFor="organizationName" error={fieldError('organizationName')}>
        <Input id="organizationName" name="organizationName" required autoFocus invalid={!!fieldError('organizationName')} />
      </Field>
      <Field label="Your name" htmlFor="fullName" error={fieldError('fullName')}>
        <Input id="fullName" name="fullName" autoComplete="name" required invalid={!!fieldError('fullName')} />
      </Field>
      <Field label="Work email" htmlFor="email" error={fieldError('email')}>
        <Input id="email" name="email" type="email" autoComplete="username" required invalid={!!fieldError('email')} />
      </Field>
      <Field label="Password" htmlFor="password" error={fieldError('password')} hint="At least 12 characters.">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          invalid={!!fieldError('password')}
        />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Creating…' : 'Create organization'}
      </Button>
    </form>
  );
}
