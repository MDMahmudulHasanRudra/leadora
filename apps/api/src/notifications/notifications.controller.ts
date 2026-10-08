import { Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type DbHandle, notifications } from '@leadora/database';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../auth/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { DB } from '../infra/tokens';

const listSchema = z.object({ unread: z.enum(['true', 'false']).optional() });
type ListQuery = z.infer<typeof listSchema>;

/** Every signed-in user owns their notifications; no extra permission is needed. */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  private mine(auth: AuthContext) {
    return and(eq(notifications.organizationId, auth.organizationId), eq(notifications.userId, auth.userId));
  }

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(listSchema)) q: ListQuery) {
    const [items, [unread]] = await Promise.all([
      this.handle.db
        .select({
          id: notifications.id,
          type: notifications.type,
          title: notifications.title,
          body: notifications.body,
          link: notifications.link,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(and(this.mine(auth), q.unread === 'true' ? isNull(notifications.readAt) : undefined))
        .orderBy(desc(notifications.createdAt))
        .limit(50),
      this.handle.db.select({ n: count() }).from(notifications).where(and(this.mine(auth), isNull(notifications.readAt))),
    ]);
    return { items, unreadCount: Number(unread?.n ?? 0) };
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll(@CurrentAuth() auth: AuthContext) {
    await this.handle.db.update(notifications).set({ readAt: new Date() }).where(and(this.mine(auth), isNull(notifications.readAt)));
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string) {
    const updated = await this.handle.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), this.mine(auth)))
      .returning({ id: notifications.id });
    if (!updated.length) throw new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found' });
  }
}
