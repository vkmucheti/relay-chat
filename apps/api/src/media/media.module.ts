import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { models } from '../database/model-names.js';
import { MessageModelModule } from '../messages/message-model.module.js';
import { MediaService } from './media.service.js';
import { uploadSchema } from './upload.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: models.upload, schema: uploadSchema }]),
    MessageModelModule,
    ConversationsModule,
  ],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
