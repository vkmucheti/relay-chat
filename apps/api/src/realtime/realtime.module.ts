import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { MetricsModule } from '../metrics/metrics.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { RealtimeGateway } from './realtime.gateway.js';

@Module({
  imports: [
    AuthModule,
    ConversationsModule,
    MessagesModule,
    MetricsModule,
    PresenceModule,
    RedisModule,
  ],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
