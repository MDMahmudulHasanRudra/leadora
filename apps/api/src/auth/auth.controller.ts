import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReqMeta, type RequestMeta } from '../common/request-meta';
import { ZodPipe } from '../common/zod.pipe';
import { type RegisterInput, registerSchema } from './auth.schemas';
import { AuthService } from './auth.service';
import { SESSION_COOKIE, SessionsService } from './sessions.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

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
}
