import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PublicCrossOrigin } from '../auth/auth-context';
import { WebChatService } from './web-chat.service';

/** What the chat widget on a customer's website talks to. No cookies; the session is the X-Chat-Token. */
@ApiTags('public')
@Controller('public/chat')
export class WebChatController {
  constructor(private readonly chat: WebChatService) {}

  @Get(':key')
  @PublicCrossOrigin()
  widget(@Param('key') key: string) {
    return this.chat.widget(key);
  }

  @Post(':key/sessions')
  @HttpCode(201)
  @PublicCrossOrigin()
  start(@Param('key') key: string, @Body() body: unknown, @Req() req: Request) {
    return this.chat.start(key, body, { origin: req.get('origin') ?? null, ip: req.ip ?? null });
  }

  @Post(':key/messages')
  @HttpCode(201)
  @PublicCrossOrigin()
  send(@Param('key') key: string, @Body() body: unknown, @Req() req: Request) {
    return this.chat.send(key, req.get('x-chat-token'), body, req.get('origin') ?? null);
  }

  @Get(':key/messages')
  @PublicCrossOrigin()
  poll(@Param('key') key: string, @Query('after') after: string | undefined, @Req() req: Request) {
    const n = Number(after ?? 0);
    return this.chat.poll(key, req.get('x-chat-token'), Number.isFinite(n) && n >= 0 ? n : 0, req.get('origin') ?? null);
  }
}
