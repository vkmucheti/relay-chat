import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { models } from '../database/model-names.js';
import { KafkaModule } from '../kafka/kafka.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { MetricsModule } from '../metrics/metrics.module.js';
import { BroadcastModule } from '../realtime/broadcast.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { MessageWorker } from './message-worker.service.js';
import { notificationSchema } from './notification.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: models.notification, schema: notificationSchema }]),
    KafkaModule,
    MessagesModule,
    ConversationsModule,
    MetricsModule,
    BroadcastModule,
    RedisModule,
  ],
  providers: [MessageWorker],
  exports: [MessageWorker],
})
export class WorkerModule {}
