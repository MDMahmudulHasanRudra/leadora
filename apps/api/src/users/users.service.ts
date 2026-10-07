import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type DbHandle, rolePermissions, roles, type Transaction, userRoles, users } from '@leadora/database';
import { and, asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth-context';
import { hashPassword } from '../auth/password';
import type { Permission } from '../auth/permissions';
import { SessionsService } from '../auth/sessions.service';
import { isUniqueViolation } from '../common/db-errors';
import type { RequestMeta } from '../common/request-meta';
import { DB } from '../infra/tokens';
import type { CreateUserInput, UpdateUserInput } from './users.schemas';

const userColumns = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  status: users.status,
  role: roles.key,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
};

const notFound = () => new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
const forbidden = () => new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to do this' });

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
  ) {}

  private baseQuery(db: DbHandle['db'] | Transaction) {
    return db
      .select(userColumns)
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId));
  }

  list(organizationId: string) {
    return this.baseQuery(this.handle.db).where(eq(users.organizationId, organizationId)).orderBy(asc(users.createdAt));
  }

  async get(organizationId: string, id: string, db: DbHandle['db'] | Transaction = this.handle.db) {
    const [row] = await this.baseQuery(db).where(and(eq(users.id, id), eq(users.organizationId, organizationId)));
    if (!row) throw notFound();
    return row;
  }

  async create(auth: AuthContext, input: CreateUserInput, meta: RequestMeta) {
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.handle.db.transaction(async (tx) => {
        const role = await this.grantableRole(tx, auth, input.role);
        const [user] = await tx
          .insert(users)
          .values({ organizationId: auth.organizationId, email: input.email, fullName: input.fullName, passwordHash, status: 'ACTIVE' })
          .returning({ id: users.id });
        await tx.insert(userRoles).values({ userId: user!.id, roleId: role.id });
        await this.audit.record(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'user.created',
          resourceType: 'user',
          resourceId: user!.id,
          newValues: { email: input.email, fullName: input.fullName, role: input.role },
          meta,
        });
        return this.get(auth.organizationId, user!.id, tx);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'users_email_unique')) {
        throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'An account with this email already exists' });
      }
      throw err;
    }
  }

  async update(auth: AuthContext, id: string, input: UpdateUserInput, meta: RequestMeta) {
    if (id === auth.userId && (input.role !== undefined || input.status !== undefined)) {
      throw new UnprocessableEntityException({ code: 'CANNOT_MODIFY_SELF', message: 'You cannot change your own role or status' });
    }
    if (input.status !== undefined && !auth.permissions.has('user.disable')) throw forbidden();
    if ((input.fullName !== undefined || input.role !== undefined) && !auth.permissions.has('user.update')) throw forbidden();

    return this.handle.db.transaction(async (tx) => {
      const current = await this.get(auth.organizationId, id, tx);
      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};

      if (input.fullName !== undefined && input.fullName !== current.fullName) {
        oldValues.fullName = current.fullName;
        newValues.fullName = input.fullName;
      }
      if (input.status !== undefined && input.status !== current.status) {
        oldValues.status = current.status;
        newValues.status = input.status;
      }
      if (newValues.fullName !== undefined || newValues.status !== undefined) {
        await tx
          .update(users)
          .set({ fullName: input.fullName ?? current.fullName, status: (input.status ?? current.status) as 'ACTIVE' | 'DISABLED' })
          .where(eq(users.id, id));
      }
      if (input.role !== undefined && input.role !== current.role) {
        const role = await this.grantableRole(tx, auth, input.role);
        await tx.delete(userRoles).where(eq(userRoles.userId, id));
        await tx.insert(userRoles).values({ userId: id, roleId: role.id });
        oldValues.role = current.role;
        newValues.role = input.role;
      }
      // Role changes apply on the next request; a disabled user must lose access immediately.
      if (newValues.status === 'DISABLED') await this.sessions.revokeAllForUser(tx, id);

      if (Object.keys(newValues).length) {
        await this.audit.record(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'user.updated',
          resourceType: 'user',
          resourceId: id,
          oldValues,
          newValues,
          meta,
        });
      }
      return this.get(auth.organizationId, id, tx);
    });
  }

  /** A caller may only grant roles whose permissions are a subset of their own. */
  private async grantableRole(tx: Transaction, auth: AuthContext, key: string) {
    const rows = await tx
      .select({ id: roles.id, permission: rolePermissions.permission })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(and(eq(roles.organizationId, auth.organizationId), eq(roles.key, key)));
    if (!rows.length) {
      throw new UnprocessableEntityException({ code: 'ROLE_NOT_FOUND', message: `Role ${key} does not exist` });
    }
    const exceeds = rows.some((r) => r.permission && !auth.permissions.has(r.permission as Permission));
    if (exceeds) {
      throw new ForbiddenException({ code: 'ROLE_ESCALATION', message: 'You cannot grant a role with more access than your own' });
    }
    return { id: rows[0]!.id };
  }
}
