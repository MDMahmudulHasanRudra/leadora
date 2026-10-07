import { boolean, pgTable, primaryKey, text, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns';
import { organizations } from './organizations';
import { users } from './users';

// Permission keys are defined in application code; rows here grant them to a role.
export const roles = pgTable(
  'roles',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: varchar({ length: 50 }).notNull(),
    name: text().notNull(),
    isSystem: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [unique('roles_organization_id_key_unique').on(t.organizationId, t.key)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: varchar({ length: 64 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export type Role = typeof roles.$inferSelect;
