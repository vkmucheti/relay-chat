import {
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PinoLogger } from 'nestjs-pino';
import type { Consumer, EachBatchPayload } from 'kafkajs';
import type { Model } from 'mongoose';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createdSchema,
  events,
  notificationSchema,
  persistedSchema,
  receiptEventSchema,
  rooms,
  topics,
  type DeadLetterEvent,
  type MessagePersisted,
} from '@relay/shared';
import { models } from '../database/model-names.js';
import { type NotificationDoc } from './notification.schema.js';
import { ConversationMembershipService } from '../conversations/conversation-membership.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { RealtimeBroadcastService } from '../realtime/broadcast.service.js';
import { RedisService } from '../redis/redis.service.js';
import { KafkaBus } from '../kafka/kafka.service.js';

export const groups = {
  [topics.created]: 'message-persister',
  [topics.persisted]: 'message-fanout',
  [topics.receipts]: 'message-receipts',
  [topics.notifications]: 'message-notifications',
} as const;
type InputTopic = keyof typeof groups;
@Injectable()
export class MessageWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly consumers: Consumer[] = [];
  private lagTimer?: NodeJS.Timeout;
  private stopping = false;
  private lagBusy = false;
  private readonly healthy = new Set<InputTopic>();
  constructor(
    private readonly bus: KafkaBus,
    private readonly messages: MessagesService,
    private readonly broadcast: RealtimeBroadcastService,
    private readonly membership: ConversationMembershipService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
    @InjectModel(models.notification) private readonly notifications: Model<NotificationDoc>,
  ) {}
  get ready() {
    return this.healthy.size === Object.keys(groups).length;
  }
  async onApplicationBootstrap() {
    await Promise.all((Object.keys(groups) as InputTopic[]).map((topic) => this.start(topic)));
    this.lagTimer = setInterval(() => void this.measureLag(), 15000);
    this.lagTimer.unref();
  }
  private async start(topic: InputTopic) {
    const groupId = groups[topic];
    const consumer = this.bus.kafka.consumer({
      groupId,
      allowAutoTopicCreation: false,
      sessionTimeout: 15000,
      rebalanceTimeout: 40000,
      heartbeatInterval: 2000,
    });
    this.consumers.push(consumer);
    consumer.on(consumer.events.GROUP_JOIN, () => {
      this.healthy.add(topic);
    });
    consumer.on(consumer.events.CRASH, ({ payload }) => {
      this.healthy.delete(topic);
      this.logger.error(
        { groupId, topic, restart: payload.restart, errorKind: payload.error.name },
        'Kafka consumer crashed',
      );
      if (!payload.restart && !this.stopping) process.kill(process.pid, 'SIGTERM');
    });
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: true });
    await consumer.run({
      autoCommit: false,
      eachBatchAutoResolve: false,
      eachBatch: (batch) => this.batch(topic, consumer, batch),
    });
  }
  private async batch(topic: InputTopic, consumer: Consumer, ctx: EachBatchPayload) {
    const { partition } = ctx.batch;
    for (const record of ctx.batch.messages) {
      if (this.stopping || !ctx.isRunning() || ctx.isStale()) return;
      const key = record.key?.toString();
      const correlation = record.headers?.['correlation-id']?.toString();
      const correlationId =
        correlation && /^[\da-f-]{36}$/.test(correlation) ? correlation : undefined;
      let failure: unknown;
      let completed = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (this.stopping || !ctx.isRunning() || ctx.isStale()) return;
        try {
          await this.process(topic, JSON.parse(record.value?.toString() ?? 'null'));
          completed = true;
          break;
        } catch (error) {
          failure = error;
          if (attempt < 3) {
            await ctx.heartbeat();
            await delay(250 * 2 ** attempt);
          }
        }
      }
      if (this.stopping || !ctx.isRunning() || ctx.isStale()) return;
      if (!completed) {
        const entry: DeadLetterEvent = {
          topic,
          partition,
          offset: record.offset,
          key: key && /^[\da-f]{24}$/.test(key) ? key : undefined,
          correlationId,
          error: failure instanceof Error ? failure.constructor.name : 'UnknownError',
          attempts: 4,
        };
        await this.bus.publish(topics.dlq, `${topic}:${partition}`, entry);
        this.logger.error(entry, 'Kafka record moved to dead-letter topic');
      }
      await consumer.commitOffsets([
        { topic, partition, offset: String(BigInt(record.offset) + 1n) },
      ]);
      ctx.resolveOffset(record.offset);
      await ctx.heartbeat();
    }
  }
  private async process(topic: InputTopic, value: unknown) {
    switch (topic) {
      case topics.created: {
        const event = createdSchema.parse(value);
        const payload = await this.messages.persist(event);
        await this.bus.publish(topics.persisted, event.conversationId, payload);
        return;
      }
      case topics.persisted:
        await this.fanout(persistedSchema.parse(value));
        return;
      case topics.receipts:
        await this.messages.receipt(receiptEventSchema.parse(value));
        return;
      case topics.notifications: {
        const { userId, messageId, conversationId } = notificationSchema.parse(value);
        await this.notifications.updateOne(
          { userId, messageId },
          { $setOnInsert: { conversationId, createdAt: new Date() } },
          { upsert: true },
        );
      }
    }
  }
  private async fanout({ message, recipients, correlationId }: MessagePersisted) {
    const [members, stored] = await Promise.all([
      this.membership.memberIds(message.conversationId),
      this.messages.findForFanout(message.messageId),
    ]);
    if (!members || !stored) return;
    const current = new Set(members);
    const exclusions = [
      ...new Set([...recipients.filter((id) => !current.has(id)), ...stored.deletedFor]),
    ];
    const audience = recipients.filter((id) => current.has(id) && !exclusions.includes(id));
    for (const userId of audience) {
      if (
        userId !== message.senderId &&
        !(await this.redis.client.zcount(`presence:user:${userId}`, Date.now() + 1, '+inf'))
      ) {
        await this.bus.publish(topics.notifications, message.conversationId, {
          userId,
          conversationId: message.conversationId,
          messageId: message.messageId,
          correlationId,
        });
      }
    }
    this.broadcast
      .conversation(message.conversationId)
      .except(exclusions.map(rooms.user))
      .emit(events.newMessage, stored.message);
    if (audience.length)
      this.broadcast
        .users(audience)
        .emit(events.conversation, { conversationId: message.conversationId });
    this.metrics.messages.inc({ stage: 'fanned_out' });
  }
  private async measureLag() {
    if (this.lagBusy || this.stopping) return;
    this.lagBusy = true;
    try {
      for (const [topic, groupId] of Object.entries(groups)) {
        const [broker, offsets] = await Promise.all([
          this.bus.admin.fetchTopicOffsets(topic),
          this.bus.admin.fetchOffsets({ groupId, topics: [topic] }),
        ]);
        for (const part of broker) {
          const offset = offsets[0]?.partitions.find(
            (item) => item.partition === part.partition,
          )?.offset;
          const committed = offset && offset !== '-1' ? offset : part.low;
          this.metrics.lag.set(
            { group: groupId, topic, partition: String(part.partition) },
            Math.max(0, Number(BigInt(part.high) - BigInt(committed))),
          );
        }
      }
    } catch {
      this.logger.warn('Unable to sample Kafka consumer lag');
    } finally {
      this.lagBusy = false;
    }
  }
  async beforeApplicationShutdown() {
    this.stopping = true;
    clearInterval(this.lagTimer);
    await Promise.allSettled(this.consumers.map((consumer) => consumer.disconnect()));
  }
}
