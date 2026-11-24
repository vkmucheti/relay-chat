import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { id } from '@relay/shared';
import { z } from 'zod';
import { ApiJsonBody } from '../common/http/api-json-body.decorator.js';
import { Current, type Actor } from '../common/http/actor.js';
import { SchemaPipe } from '../common/http/schema.pipe.js';
import { pageInput, readInput, scope } from './messages.dto.js';
import { MessagesService } from './messages.service.js';
@ApiTags('messages')
@ApiBearerAuth()
@Controller()
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}
  @Get('conversations/:id/messages')
  history(
    @Current() actor: Actor,
    @Param('id', new SchemaPipe(id)) cid: string,
    @Query(new SchemaPipe(pageInput)) query: z.infer<typeof pageInput>,
  ) {
    return this.messages.history(actor.sub, cid, query);
  }
  @Delete('messages/:id')
  @HttpCode(204)
  remove(
    @Current() actor: Actor,
    @Param('id', new SchemaPipe(id)) mid: string,
    @Query('scope', new SchemaPipe(scope)) target: z.infer<typeof scope>,
  ) {
    return this.messages.remove(actor.sub, mid, target === 'everyone');
  }
  @ApiJsonBody(readInput)
  @Post('conversations/:id/read')
  @HttpCode(202)
  read(
    @Current() actor: Actor,
    @Param('id', new SchemaPipe(id)) cid: string,
    @Body(new SchemaPipe(readInput)) body: z.infer<typeof readInput>,
  ) {
    return this.messages.enqueueReceipt(actor.sub, { ...body, conversationId: cid }, 'read');
  }
}
