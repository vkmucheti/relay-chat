import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { models } from '../database/model-names.js';
import { KafkaModule } from '../kafka/kafka.module.js';
import { MediaModule } from '../media/media.module.js';
import { MetricsModule } from '../metrics/metrics.module.js';
import { BroadcastModule } from '../realtime/broadcast.module.js';
import { MessageModelModule } from './message-model.module.js';
import { MessagesService } from './messages.service.js';
import { reservationSchema } from './send-reservation.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: models.reservation, schema: reservationSchema }]),
    MessageModelModule,
    ConversationsModule,
    KafkaModule,
    MediaModule,
    MetricsModule,
    BroadcastModule,
  ],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
