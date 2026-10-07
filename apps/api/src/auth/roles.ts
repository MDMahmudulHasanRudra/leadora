import { rolePermissions, roles, type Transaction } from '@leadora/database';
import { DEFAULT_ROLES, ROLE_KEYS, type RoleKey } from './permissions';

/** Creates the system roles for a new organization; returns role ids by key. */
export async function seedDefaultRoles(tx: Transaction, organizationId: string): Promise<Record<RoleKey, string>> {
  const created = await tx
    .insert(roles)
    .values(ROLE_KEYS.map((key) => ({ organizationId, key, name: DEFAULT_ROLES[key].name, isSystem: true })))
    .returning({ id: roles.id, key: roles.key });

  const ids = Object.fromEntries(created.map((r) => [r.key, r.id])) as Record<RoleKey, string>;
  await tx
    .insert(rolePermissions)
    .values(ROLE_KEYS.flatMap((key) => DEFAULT_ROLES[key].permissions.map((permission) => ({ roleId: ids[key], permission }))));
  return ids;
}
