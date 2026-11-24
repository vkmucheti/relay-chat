import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { models } from '../database/model-names.js';
import { MessageModelModule } from '../messages/message-model.module.js';
import { BroadcastModule } from '../realtime/broadcast.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { UsersModule } from '../users/users.module.js';
import { ConversationMembershipService } from './conversation-membership.service.js';
import { conversationSchema } from './conversation.schema.js';
import { ConversationsService } from './conversations.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: models.conversation, schema: conversationSchema }]),
    MessageModelModule,
    UsersModule,
    RedisModule,
    BroadcastModule,
  ],
  providers: [ConversationMembershipService, ConversationsService],
  exports: [ConversationMembershipService, ConversationsService, MongooseModule],
})
export class ConversationsModule {}
