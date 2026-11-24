import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { models } from '../database/model-names.js';
import { messageSchema } from './message.schema.js';

@Module({
  imports: [MongooseModule.forFeature([{ name: models.message, schema: messageSchema }])],
  exports: [MongooseModule],
})
export class MessageModelModule {}
