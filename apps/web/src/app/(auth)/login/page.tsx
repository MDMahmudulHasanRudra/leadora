import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui';
import { getIdentity } from '@/lib/api-server';
import { getSetupStatus } from '../setup-status';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getIdentity()) redirect('/');
  const status = await getSetupStatus();
  if (status.setupRequired) redirect('/setup');

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-500">Welcome back. Use your work email.</p>
      <LoginForm />
      {status.signupOpen && (
        <p className="mt-6 text-center text-sm text-zinc-500">
          New here?{' '}
          <Link href="/setup" className="font-medium text-brand-600 hover:underline">
            Create an organization
          </Link>
        </p>
      )}
    </Card>
  );
}
