import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ReqMeta, type RequestMeta } from '../common/request-meta';
import { ZodPipe } from '../common/zod.pipe';
import { type CreateUserInput, createUserSchema, type UpdateUserInput, updateUserSchema } from './users.schemas';
import { UsersService } from './users.service';

// Malformed ids get the same 404 as ids from other organizations.
const UserId = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('user.view')
  async list(@CurrentAuth() auth: AuthContext) {
    return { items: await this.users.list(auth.organizationId) };
  }

  @Get(':id')
  @RequirePermission('user.view')
  get(@CurrentAuth() auth: AuthContext, @Param('id', UserId) id: string) {
    return this.users.get(auth.organizationId, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('user.create')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(createUserSchema)) body: CreateUserInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.users.create(auth, body, meta);
  }

  // Field-level permissions (user.update / user.disable) are checked in the service.
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UserId) id: string,
    @Body(new ZodPipe(updateUserSchema)) body: UpdateUserInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.users.update(auth, id, body, meta);
  }
}
