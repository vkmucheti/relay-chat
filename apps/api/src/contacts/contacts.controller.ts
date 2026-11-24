import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { id } from '@relay/shared';
import { z } from 'zod';
import { ApiJsonBody } from '../common/http/api-json-body.decorator.js';
import { Current, type Actor } from '../common/http/actor.js';
import { SchemaPipe } from '../common/http/schema.pipe.js';
import { input } from './contacts.dto.js';
import { ContactsService } from './contacts.service.js';
@ApiTags('contacts')
@ApiBearerAuth()
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}
  @Get() list(@Current() actor: Actor) {
    return this.contacts.list(actor.sub);
  }
  @ApiJsonBody(input)
  @Post()
  save(@Current() actor: Actor, @Body(new SchemaPipe(input)) body: z.infer<typeof input>) {
    return this.contacts.save(actor.sub, body);
  }
  @Delete(':id') @HttpCode(204) remove(
    @Current() actor: Actor,
    @Param('id', new SchemaPipe(id)) cid: string,
  ) {
    return this.contacts.delete(actor.sub, cid);
  }
}
