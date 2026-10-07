import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui';
import { getSetupStatus } from '../setup-status';
import { SetupForm } from './setup-form';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const status = await getSetupStatus();
  if (!status.signupOpen) redirect('/login');

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold">{status.setupRequired ? 'Set up Leadora' : 'Create an organization'}</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-500">
        {status.setupRequired
          ? 'Create your organization and the first admin account.'
          : 'You will be the admin of the new organization.'}
      </p>
      <SetupForm />
      {!status.setupRequired && (
        <p className="mt-6 text-center text-sm text-zinc-500">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      )}
    </Card>
  );
}
