import 'server-only';
import { apiGet } from '@/lib/api-server';

export async function getSetupStatus() {
  const { data } = await apiGet<{ setupRequired: boolean; signupOpen: boolean }>('/auth/setup-status');
  return data ?? { setupRequired: false, signupOpen: false };
}
