import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import {
  type CreateFollowupInput,
  createFollowupSchema,
  FollowupsService,
  type ListFollowupsQuery,
  listFollowupsSchema,
  type UpdateFollowupInput,
  updateFollowupSchema,
} from './followups.service';

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('followups')
@Controller()
export class FollowupsController {
  constructor(private readonly followups: FollowupsService) {}

  @Get('followups')
  @RequirePermission('followup.view')
  async list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(listFollowupsSchema)) q: ListFollowupsQuery) {
    return { items: await this.followups.list(auth, q) };
  }

  @Post('leads/:id/followups')
  @HttpCode(201)
  @RequirePermission('followup.create')
  create(@CurrentAuth() auth: AuthContext, @Param('id', Id) leadId: string, @Body(new ZodPipe(createFollowupSchema)) body: CreateFollowupInput) {
    return this.followups.create(auth, leadId, body);
  }

  @Patch('followups/:id')
  @RequirePermission('followup.complete')
  update(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Body(new ZodPipe(updateFollowupSchema)) body: UpdateFollowupInput) {
    return this.followups.update(auth, id, body);
  }
}
