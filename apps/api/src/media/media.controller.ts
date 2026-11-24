import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { mediaKeySchema } from '@relay/shared';
import { z } from 'zod';
import { ApiJsonBody } from '../common/http/api-json-body.decorator.js';
import { Current, type Actor } from '../common/http/actor.js';
import { SchemaPipe } from '../common/http/schema.pipe.js';
import { input } from './media.dto.js';
import { MediaService } from './media.service.js';
@Controller('media')
@ApiTags('media')
@ApiBearerAuth()
export class MediaController {
  constructor(private readonly media: MediaService) {}
  @ApiJsonBody(input)
  @Post('presign-upload')
  upload(@Current() actor: Actor, @Body(new SchemaPipe(input)) body: z.infer<typeof input>) {
    return this.media.upload(actor.sub, body);
  }
  @Get('presign-download') download(
    @Current() actor: Actor,
    @Query('key', new SchemaPipe(mediaKeySchema)) key: string,
  ) {
    return this.media.download(actor.sub, key);
  }
}
