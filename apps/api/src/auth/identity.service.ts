import { Inject, Injectable } from '@nestjs/common';
import { type DbHandle, organizations, rolePermissions, roles, userRoles, users } from '@leadora/database';
import { and, eq } from 'drizzle-orm';
import { DB } from '../infra/tokens';
import type { Permission } from './permissions';

export interface Identity {
  user: { id: string; email: string; fullName: string; status: string; role: string; timezone: string };
  organization: { id: string; name: string; slug: string };
  permissions: Permission[];
}

@Injectable()
export class IdentityService {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** Loads a user with role and permissions, scoped to the organization. */
  async load(userId: string, organizationId: string): Promise<Identity | null> {
    const rows = await this.handle.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        status: users.status,
        timezone: users.timezone,
        orgTimezone: organizations.timezone,
        role: roles.key,
        permission: rolePermissions.permission,
        orgId: organizations.id,
        orgName: organizations.name,
        orgSlug: organizations.slug,
      })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)));

    const first = rows[0];
    if (!first) return null;
    return {
      user: {
        id: first.id,
        email: first.email,
        fullName: first.fullName,
        status: first.status,
        role: first.role ?? 'NONE',
        timezone: first.timezone ?? first.orgTimezone,
      },
      organization: { id: first.orgId, name: first.orgName, slug: first.orgSlug },
      permissions: [...new Set(rows.map((r) => r.permission).filter((p): p is string => !!p))] as Permission[],
    };
  }
}
