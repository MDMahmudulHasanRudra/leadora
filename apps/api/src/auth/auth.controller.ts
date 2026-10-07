import { Body, Controller, Get, HttpCode, NotFoundException, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReqMeta, type RequestMeta } from '../common/request-meta';
import { ZodPipe } from '../common/zod.pipe';
import { type AuthContext, CurrentAuth, Public } from './auth-context';
import { type LoginInput, loginSchema, type RegisterInput, registerSchema } from './auth.schemas';
import { AuthService } from './auth.service';
import { IdentityService } from './identity.service';
import { SESSION_COOKIE, SessionsService } from './sessions.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly identity: IdentityService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(201)
  async register(
    @Body(new ZodPipe(registerSchema)) body: RegisterInput,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, ...result } = await this.auth.register(body, meta);
    res.cookie(SESSION_COOKIE, token, this.sessions.cookieOptions());
    return result;
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, ...identity } = await this.auth.login(body, meta);
    res.cookie(SESSION_COOKIE, token, this.sessions.cookieOptions());
    return identity;
  }

  @Get('me')
  async me(@CurrentAuth() auth: AuthContext) {
    const identity = await this.identity.load(auth.userId, auth.organizationId);
    if (!identity) throw new NotFoundException();
    return identity;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(auth.sessionToken);
    const { maxAge: _maxAge, ...cookie } = this.sessions.cookieOptions();
    res.clearCookie(SESSION_COOKIE, cookie);
  }
}
