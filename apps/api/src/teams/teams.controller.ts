import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ReqMeta, type RequestMeta } from '../common/request-meta';
import { ZodPipe } from '../common/zod.pipe';
import { type CreateTeamInput, createTeamSchema, type UpdateTeamInput, updateTeamSchema } from './teams.schemas';
import { TeamsService } from './teams.service';

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequirePermission('team.view')
  async list(@CurrentAuth() auth: AuthContext) {
    return { items: await this.teams.list(auth.organizationId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('team.manage')
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(createTeamSchema)) body: CreateTeamInput, @ReqMeta() meta: RequestMeta) {
    return this.teams.create(auth, body, meta);
  }

  @Patch(':id')
  @RequirePermission('team.manage')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', Id) id: string,
    @Body(new ZodPipe(updateTeamSchema)) body: UpdateTeamInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.teams.update(auth, id, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('team.manage')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @ReqMeta() meta: RequestMeta) {
    await this.teams.remove(auth, id, meta);
  }

  @Put(':id/members/:userId')
  @HttpCode(204)
  @RequirePermission('team.manage')
  async addMember(
    @CurrentAuth() auth: AuthContext,
    @Param('id', Id) id: string,
    @Param('userId', Id) userId: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.teams.addMember(auth, id, userId, meta);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  @RequirePermission('team.manage')
  async removeMember(
    @CurrentAuth() auth: AuthContext,
    @Param('id', Id) id: string,
    @Param('userId', Id) userId: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.teams.removeMember(auth, id, userId, meta);
  }
}
