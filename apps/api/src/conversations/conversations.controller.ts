import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { id } from '@relay/shared';
import type { z } from 'zod';
import { ApiJsonBody } from '../common/http/api-json-body.decorator.js';
import { Current, type Actor } from '../common/http/actor.js';
import { SchemaPipe } from '../common/http/schema.pipe.js';
import {
  directInput,
  groupInput,
  membersInput,
  pageInput,
  updateInput,
} from './conversations.dto.js';
import { ConversationsService } from './conversations.service.js';
@Controller('conversations')
@ApiTags('conversations')
@ApiBearerAuth()
export class ConversationsController {
  constructor(private readonly chat: ConversationsService) {}
  @Get() list(
    @Current() actor: Actor,
    @Query(new SchemaPipe(pageInput)) query: z.infer<typeof pageInput>,
  ) {
    return this.chat.list(actor.sub, query);
  }
  @Get(':id') one(@Current() actor: Actor, @Param('id', new SchemaPipe(id)) cid: string) {
    return this.chat.one(cid, actor.sub);
  }
  @ApiJsonBody(directInput)
  @Post('direct')
  direct(
    @Current() actor: Actor,
    @Body(new SchemaPipe(directInput)) body: z.infer<typeof directInput>,
  ) {
    return this.chat.direct(actor.sub, body.userId);
  }
  @ApiJsonBody(groupInput)
  @Post('group')
  group(
    @Current() actor: Actor,
    @Body(new SchemaPipe(groupInput)) body: z.infer<typeof groupInput>,
  ) {
    return this.chat.group(actor.sub, body);
  }
  @ApiJsonBody(updateInput)
  @Patch(':id')
  update(
    @Current() actor: Actor,
    @Param('id', new SchemaPipe(id)) cid: string,
    @Body(new SchemaPipe(updateInput)) body: z.infer<typeof updateInput>,
  ) {
    return this.chat.update(actor.sub, cid, body);
  }
  @ApiJsonBody(membersInput)
  @Post(':id/members')
  add(
    @Current() actor: Actor,
    @Param('id', new SchemaPipe(id)) cid: string,
    @Body(new SchemaPipe(membersInput)) body: z.infer<typeof membersInput>,
  ) {
    return this.chat.changeMembers(actor.sub, cid, body.userIds, 'add');
  }
  @ApiJsonBody(membersInput)
  @Delete(':id/members')
  remove(
    @Current() actor: Actor,
    @Param('id', new SchemaPipe(id)) cid: string,
    @Body(new SchemaPipe(membersInput)) body: z.infer<typeof membersInput>,
  ) {
    return this.chat.changeMembers(actor.sub, cid, body.userIds, 'remove');
  }
  @Post(':id/leave') leave(@Current() actor: Actor, @Param('id', new SchemaPipe(id)) cid: string) {
    return this.chat.changeMembers(actor.sub, cid, [actor.sub], 'leave');
  }
}
