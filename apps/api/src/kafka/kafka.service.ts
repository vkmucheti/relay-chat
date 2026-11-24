import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type ClientKafkaProxy } from '@nestjs/microservices';
import { Kafka, type Admin } from 'kafkajs';
import { firstValueFrom } from 'rxjs';
import {
  topics,
  type MessageCreated,
  type MessagePersisted,
  type ReceiptEvent,
  type NotificationEvent,
  type DeadLetterEvent,
} from '@relay/shared';
import { ENV, type Env } from '../config/environment.js';
import { MetricsService } from '../metrics/metrics.service.js';

import { KAFKA_PRODUCER, connection } from './kafka.options.js';
export interface TopicPayloads {
  [topics.created]: MessageCreated;
  [topics.persisted]: MessagePersisted;
  [topics.receipts]: ReceiptEvent;
  [topics.notifications]: NotificationEvent;
  [topics.dlq]: DeadLetterEvent;
}
@Injectable()
export class KafkaBus implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly kafka: Kafka;
  readonly admin: Admin;
  constructor(
    @Inject(KAFKA_PRODUCER) private readonly producer: ClientKafkaProxy,
    @Inject(ENV) env: Env,
    private readonly metrics: MetricsService,
  ) {
    this.kafka = new Kafka(connection(env));
    this.admin = this.kafka.admin();
  }
  async onApplicationBootstrap() {
    await Promise.all([this.producer.connect(), this.admin.connect()]);
  }
  async publish<T extends keyof TopicPayloads>(topic: T, key: string, event: TopicPayloads[T]) {
    const correlationId = event.correlationId;
    await firstValueFrom(
      this.producer.emit(topic, {
        key,
        value: JSON.stringify(event),
        headers: correlationId ? { 'correlation-id': correlationId } : {},
      }),
    );
    if (topic === topics.created) this.metrics.messages.inc({ stage: 'produced' });
    if (topic === topics.dlq) this.metrics.dlq.inc({ topic: (event as DeadLetterEvent).topic });
  }
  async health() {
    const metadata = await this.admin.fetchTopicMetadata({ topics: Object.values(topics) });
    if (
      metadata.topics.length !== Object.keys(topics).length ||
      metadata.topics.some((topic) => topic.partitions.some((part) => part.leader < 0))
    ) {
      throw new Error('Kafka topic is unavailable');
    }
  }
  async onApplicationShutdown() {
    await this.admin.disconnect();
  }
}
