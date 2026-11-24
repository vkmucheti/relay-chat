import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { BroadcastModule } from '../realtime/broadcast.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { UsersModule } from '../users/users.module.js';
import { PresenceService } from './presence.service.js';

@Module({
  imports: [ConversationsModule, BroadcastModule, RedisModule, UsersModule],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
