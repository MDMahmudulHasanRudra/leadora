import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
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
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & AuthedRequest>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const unauthenticated = new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in required' });
    if (typeof token !== 'string' || !token) throw unauthenticated;

    const session = await this.sessions.findActive(token);
    if (!session) throw unauthenticated;
    const identity = await this.identity.load(session.userId, session.organizationId);
    if (!identity || identity.user.status !== 'ACTIVE') throw unauthenticated;

    req.auth = {
      userId: identity.user.id,
      organizationId: identity.organization.id,
      sessionToken: token,
      role: identity.user.role,
      permissions: new Set(identity.permissions),
    };

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    const missing = required.filter((p) => !req.auth!.permissions.has(p));
    if (missing.length) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to do this' });
    }
    return true;
  }
}
