import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';

export interface AuthContext {
  userId: string;
  organizationId: string;
  sessionToken: string;
  role: string;
  permissions: ReadonlySet<Permission>;
}

export type AuthedRequest = { auth?: AuthContext };

export const IS_PUBLIC = 'auth:isPublic';
export const REQUIRED_PERMISSIONS = 'auth:permissions';

/** Opt a route out of authentication. Everything else requires a session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Require every listed permission. */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new Error('CurrentAuth used on a public route');
  return auth;
});
