import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiJsonBody } from '../common/http/api-json-body.decorator.js';
import { Current, type Actor } from '../common/http/actor.js';
import { SchemaPipe } from '../common/http/schema.pipe.js';
import { profileSchema, searchSchema } from './users.dto.js';
import { UsersService } from './users.service.js';
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get('me') me(@Current() actor: Actor) {
    return this.users.me(actor.sub);
  }
  @ApiJsonBody(profileSchema)
  @Patch('me')
  update(
    @Current() actor: Actor,
    @Body(new SchemaPipe(profileSchema)) body: z.infer<typeof profileSchema>,
  ) {
    return this.users.update(actor.sub, body);
  }
  @Get('search') search(
    @Current() actor: Actor,
    @Query('q', new SchemaPipe(searchSchema)) q: string,
  ) {
    return this.users.search(actor.sub, q);
  }
}
