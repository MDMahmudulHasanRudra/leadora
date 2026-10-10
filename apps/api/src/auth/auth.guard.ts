import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiKeysService, scopePermissions } from '../api-keys/api-keys.service';
import { type AuthedRequest, IS_PUBLIC, REQUIRED_PERMISSIONS } from './auth-context';
import { IdentityService } from './identity.service';
import type { Permission } from './permissions';
import { SESSION_COOKIE, SessionsService } from './sessions.service';

/** Deny by default: every route needs an active session unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
    private readonly identity: IdentityService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & AuthedRequest>();
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    const bearer = req.get('authorization');
    if (bearer?.startsWith('Bearer ')) return this.viaApiKey(req, bearer.slice(7).trim(), required);

    const token: unknown = req.cookies?.[SESSION_COOKIE];
    // Built only when thrown: constructing an exception captures a stack trace, which is not free on every request.
    const unauthenticated = () => new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in required' });
    if (typeof token !== 'string' || !token) throw unauthenticated();

    const session = await this.sessions.findActive(token);
    if (!session) throw unauthenticated();
    const identity = await this.identity.load(session.userId, session.organizationId);
    if (!identity || identity.user.status !== 'ACTIVE') throw unauthenticated();

    req.auth = {
      userId: identity.user.id,
      organizationId: identity.organization.id,
      sessionToken: token,
      role: identity.user.role,
      permissions: new Set(identity.permissions),
    };

    const missing = required.filter((p) => !req.auth!.permissions.has(p));
    if (missing.length) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to do this' });
    }
    return true;
  }
  /**
   * Spec §92: a key acts as its creator, limited to its scopes, and only on routes that declare permissions
   * (deny by default: no profile, notifications, sessions or settings through a key).
   */
  private async viaApiKey(req: Request & AuthedRequest, raw: string, required: Permission[]): Promise<boolean> {
    const invalid = () => new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'The API key is invalid, revoked or expired' });
    const key = await this.apiKeys.authenticate(raw);
    if (!key) throw invalid();
    const identity = await this.identity.load(key.createdByUserId, key.organizationId);
    if (!identity || identity.user.status !== 'ACTIVE') throw invalid();
    await this.apiKeys.assertWithinRate(key.keyId);

    const granted = scopePermissions(key.scopes);
    const permissions = new Set(identity.permissions.filter((p) => granted.has(p)));
    if (required.length === 0 || required.some((p) => !permissions.has(p))) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This API key is not allowed to use this endpoint' });
    }
    req.auth = { userId: identity.user.id, organizationId: identity.organization.id, sessionToken: '', role: identity.user.role, permissions, apiKeyId: key.id };
    return true;
  }
}