import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Env } from '@leadora/config';
import { type DbHandle, organizations, type Transaction, userRoles, users } from '@leadora/database';
import { count, eq, like, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolation } from '../common/db-errors';
import type { RequestMeta } from '../common/request-meta';
import { DB, ENV } from '../infra/tokens';
import type { LoginInput, RegisterInput } from './auth.schemas';
import { IdentityService } from './identity.service';
import { LoginRateLimiter } from './login-rate-limiter';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password';
import { seedDefaultRoles } from './roles';
import { SessionsService } from './sessions.service';

const invalidCredentials = () =>
  new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });

// Arbitrary constant serializing first-run registration across API instances.
const REGISTRATION_LOCK = 4_242_001;

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return slug || 'org';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
    private readonly identity: IdentityService,
    private readonly limiter: LoginRateLimiter,
  ) {}

  async setupStatus() {
    const [{ n } = { n: 0 }] = await this.handle.db.select({ n: count() }).from(organizations);
    return { setupRequired: n === 0, signupOpen: n === 0 || this.env.ALLOW_SIGNUP };
  }

  async login(input: LoginInput, meta: RequestMeta) {
    await this.limiter.assertAllowed(meta.ip, input.email);

    const [user] = await this.handle.db.select().from(users).where(eq(users.email, input.email)).limit(1);
    const valid = user?.passwordHash
      ? await verifyPassword(user.passwordHash, input.password)
      : (await burnPasswordCheck(input.password), false);

    if (!user || !valid) {
      await this.limiter.recordFailure(meta.ip, input.email);
      this.logger.warn({ ip: meta.ip }, 'auth.login_failed');
      throw invalidCredentials();
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'ACCOUNT_DISABLED', message: 'This account is disabled' });
    }

    await this.limiter.reset(meta.ip, input.email);
    const token = await this.handle.db.transaction(async (tx) => {
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await this.audit.record(tx, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: 'auth.login',
        resourceType: 'user',
        resourceId: user.id,
        meta,
      });
      return this.sessions.create(tx, user.id, user.organizationId, meta);
    });

    const identity = await this.identity.load(user.id, user.organizationId);
    return { token, ...identity! };
  }

  async register(input: RegisterInput, meta: RequestMeta) {
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.handle.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${REGISTRATION_LOCK})`);
        if (!this.env.ALLOW_SIGNUP) {
          const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(organizations);
          if (n > 0) {
            throw new ForbiddenException({ code: 'SIGNUP_DISABLED', message: 'Registration is closed. Ask an admin for an account.' });
          }
        }

        const [org] = await tx
          .insert(organizations)
          .values({
            name: input.organizationName,
            slug: await this.uniqueSlug(tx, input.organizationName),
            timezone: input.timezone ?? 'UTC',
          })
          .returning();
        const roleIds = await seedDefaultRoles(tx, org!.id);
        const [user] = await tx
          .insert(users)
          .values({
            organizationId: org!.id,
            email: input.email,
            fullName: input.fullName,
            passwordHash,
            status: 'ACTIVE',
            lastLoginAt: new Date(),
          })
          .returning();
        await tx.insert(userRoles).values({ userId: user!.id, roleId: roleIds.ADMIN });

        await this.audit.record(tx, {
          organizationId: org!.id,
          actorUserId: user!.id,
          action: 'organization.created',
          resourceType: 'organization',
          resourceId: org!.id,
          newValues: { name: org!.name, slug: org!.slug },
          meta,
        });
        await this.audit.record(tx, {
          organizationId: org!.id,
          actorUserId: user!.id,
          action: 'auth.registered',
          resourceType: 'user',
          resourceId: user!.id,
          newValues: { email: user!.email, role: 'ADMIN' },
          meta,
        });

        const token = await this.sessions.create(tx, user!.id, org!.id, meta);
        return {
          token,
          user: {
            id: user!.id,
            email: user!.email,
            fullName: user!.fullName,
            status: user!.status,
            role: 'ADMIN' as const,
            timezone: org!.timezone,
          },
          organization: { id: org!.id, name: org!.name, slug: org!.slug },
        };
      });
    } catch (err) {
      if (isUniqueViolation(err, 'users_email_unique')) {
        throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'An account with this email already exists' });
      }
      throw err;
    }
  }

  private async uniqueSlug(tx: Transaction, name: string): Promise<string> {
    const base = slugify(name);
    const taken = new Set(
      (await tx.select({ slug: organizations.slug }).from(organizations).where(like(organizations.slug, `${base}%`))).map((r) => r.slug),
    );
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }
}
