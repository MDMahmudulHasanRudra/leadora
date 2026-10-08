import { organizations, rolePermissions, roles, userRoles, users } from '@leadora/database';
import { and, eq } from 'drizzle-orm';
import { hashPassword } from '../../src/auth/password';
import { initializeOrganization } from '../../src/organizations/defaults';
import type { TestApp } from './app';
import { login } from './fixtures';

/** Creates an extra organization directly (registration is closed after first run) and logs its admin in. */
export async function createOtherOrg(t: TestApp, slug: string) {
  const email = `admin@${slug}.test`;
  const password = 'another strong password';
  await t.db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: slug, slug }).returning();
    const { roleIds: ids } = await initializeOrganization(tx, org!.id);
    const [user] = await tx
      .insert(users)
      .values({ organizationId: org!.id, email, fullName: 'Other Admin', status: 'ACTIVE', passwordHash: await hashPassword(password) })
      .returning();
    await tx.insert(userRoles).values({ userId: user!.id, roleId: ids.ADMIN });
  });
  return (await login(t, email, password)).agent;
}

/** Grants an extra permission to a role in the (single) first organization. */
export async function grant(t: TestApp, roleKey: string, permission: string) {
  const [org] = await t.db.select().from(organizations).limit(1);
  const [role] = await t.db
    .select()
    .from(roles)
    .where(and(eq(roles.organizationId, org!.id), eq(roles.key, roleKey)));
  await t.db.insert(rolePermissions).values({ roleId: role!.id, permission });
}
