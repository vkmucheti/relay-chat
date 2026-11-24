import type { ConversationDoc } from '../conversations/conversation.schema.js';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  events,
  topics,
  type DeletedMessage,
  type Media,
  type Message,
  type MessageCreated,
  type MessagePersisted,
  type Page,
  type ReceiptEvent,
  type ReceiptInput,
  type ReceiptUpdate,
  type SendAccepted,
  type SendMessage,
} from '@relay/shared';
import { randomUUID } from 'node:crypto';
import {
  Types,
  trusted,
  type ClientSession,
  type Connection,
  type Model,
  type QueryFilter,
} from 'mongoose';
import { z } from 'zod';
import { duplicate, objectId } from '../database/mongo.js';
import { models } from '../database/model-names.js';
import { type MessageDoc } from './message.schema.js';
import { type ReservationDoc } from './send-reservation.schema.js';
import { ENV, type Env } from '../config/environment.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import {
  ConversationMembershipService,
  requireMembership,
} from '../conversations/conversation-membership.service.js';
import { KafkaBus } from '../kafka/kafka.service.js';
import { MediaService } from '../media/media.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { RealtimeBroadcastService } from '../realtime/broadcast.service.js';
import { messageView } from './message-view.js';
import { pageInput } from './messages.dto.js';
import { sendFingerprint, assertMatchingSend } from './send-idempotency.js';
const actorKey = (senderId: string, clientMessageId: string) => ({ senderId, clientMessageId });

@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(models.message) private readonly model: Model<MessageDoc>,
    @InjectModel(models.conversation) private readonly conversationModel: Model<ConversationDoc>,
    @InjectModel(models.reservation) private readonly reservations: Model<ReservationDoc>,
    @InjectConnection() private readonly mongo: Connection,
    @Inject(ENV) private readonly env: Env,
    private readonly membership: ConversationMembershipService,
    private readonly conversations: ConversationsService,
    private readonly media: MediaService,
    private readonly bus: KafkaBus,
    private readonly broadcast: RealtimeBroadcastService,
    private readonly metrics: MetricsService,
  ) {}

  async hasMessage(senderId: string, clientMessageId: string) {
    return Boolean(await this.model.exists(actorKey(senderId, clientMessageId)));
  }
  async findForFanout(messageId: string) {
    const stored = await this.model.findById(messageId).lean();
    if (!stored) return;
    return { message: messageView(stored), deletedFor: stored.deletedFor.map(String) };
  }
  async history(
    actor: string,
    conversationId: string,
    { before, after, limit }: z.infer<typeof pageInput>,
  ): Promise<Page<Message>> {
    await this.membership.authorize(conversationId, actor);
    const filter: QueryFilter<MessageDoc> = {
      conversationId: objectId(conversationId),
      deletedFor: trusted({ $ne: objectId(actor) }),
    };
    const cursor = before ?? after;
    if (cursor) {
      const pos = await this.model
        .findOne({ _id: cursor, conversationId })
        .select('sequence')
        .lean();
      if (!pos) throw new BadRequestException('Message cursor is unavailable');
      if (pos.sequence !== undefined) {
        if (after) filter.sequence = trusted({ $gt: pos.sequence });
        else
          filter.$or = [
            { sequence: trusted({ $lt: pos.sequence }) },
            { sequence: trusted({ $exists: false }) },
          ];
      } else if (after) {
        filter.$or = [
          { sequence: trusted({ $exists: true }) },
          { sequence: trusted({ $exists: false }), _id: trusted({ $gt: pos._id }) },
        ];
      } else {
        filter.sequence = trusted({ $exists: false });
        filter._id = trusted({ $lt: pos._id });
      }
    }
    const direction = after ? 1 : -1;
    const records = await this.model
      .find(filter)
      .sort({ sequence: direction, _id: direction })
      .limit(limit + 1)
      .lean();
    const page = records.slice(0, limit);
    const last = page.at(-1);
    return {
      items: (after ? page : page.reverse()).map(messageView),
      nextCursor: last && records.length > limit ? String(last._id) : undefined,
    };
  }
  async send(actor: string, data: SendMessage): Promise<SendAccepted> {
    await this.membership.cached(data.conversationId, actor);
    // Authoritative check keeps revoked users out even before cache invalidation propagates.
    await this.membership.authorize(data.conversationId, actor);
    const filter = actorKey(actor, data.clientMessageId);
    const fingerprint = sendFingerprint(data);
    let stored = await this.reservations.findOne(filter).lean();
    if (!stored) {
      if (
        data.replyTo &&
        !(await this.model.exists({
          _id: data.replyTo,
          conversationId: data.conversationId,
          deletedFor: trusted({ $ne: actor }),
        }))
      ) {
        throw new BadRequestException('The reply target is unavailable');
      }
      const media: Media | undefined =
        data.type === 'text'
          ? undefined
          : await this.media.verified(actor, data.conversationId, data.mediaKey, data.type);
      const createdAt = new Date().toISOString();
      const event: MessageCreated = {
        messageId: new Types.ObjectId().toHexString(),
        senderId: actor,
        clientMessageId: data.clientMessageId,
        conversationId: data.conversationId,
        type: data.type,
        replyTo: data.replyTo,
        body: data.type === 'text' ? data.body : undefined,
        media,
        createdAt,
        correlationId: randomUUID(),
      };
      try {
        stored = (await this.reservations.create({ ...filter, fingerprint, event })).toObject();
      } catch (error) {
        if (!duplicate(error)) throw error;
        stored = await this.reservations.findOne(filter).lean();
        if (!stored) throw error;
      }
    }
    const event = assertMatchingSend(stored, fingerprint);
    await this.bus.publish(topics.created, data.conversationId, event);
    return { clientMessageId: data.clientMessageId, messageId: event.messageId, status: 'sent' };
  }

  async persist(event: MessageCreated): Promise<MessagePersisted> {
    const result = await this.mongo.transaction(async (session) => {
      const filter = actorKey(event.senderId, event.clientMessageId);
      const stored = await this.model.findOne(filter).session(session).lean();
      if (stored) return { doc: stored, inserted: false };
      const { doc: conversation } = await this.membership.authorize(
        event.conversationId,
        event.senderId,
        { session },
      );
      const recipients = conversation.members.map((member) => member.userId);
      const sequence = (conversation.messageSequence ?? 0) + 1;
      const [created] = await this.model.create(
        [
          {
            _id: objectId(event.messageId),
            ...filter,
            conversationId: event.conversationId,
            type: event.type,
            body: event.body,
            media: event.media,
            replyTo: event.replyTo,
            sequence,
            createdAt: new Date(event.createdAt),
            recipients,
          },
        ],
        { session },
      );
      const doc = created.toObject();
      await this.conversationModel.updateOne(
        { _id: event.conversationId },
        {
          $set: { lastMessage: messageView(doc), messageSequence: sequence, updatedAt: new Date() },
          $inc: { 'members.$[unread].unreadCount': 1 },
        },
        { session, arrayFilters: [{ 'unread.userId': { $ne: objectId(event.senderId) } }] },
      );
      return { doc, inserted: true };
    });
    const { doc } = result;
    const recipients = doc.recipients.map(String);
    await this.conversations.invalidate(recipients, undefined, event.conversationId);
    if (result.inserted) this.metrics.messages.inc({ stage: 'persisted' });
    return { message: messageView(doc), recipients, correlationId: event.correlationId };
  }

  private async target(actor: string, input: ReceiptInput, session?: ClientSession) {
    const { doc: conversation, member } = await this.membership.authorize(
      input.conversationId,
      actor,
      { session },
    );
    const doc = await this.model
      .findOne({
        _id: input.messageId,
        conversationId: input.conversationId,
        deletedFor: trusted({ $ne: actor }),
      })
      .session(session ?? null)
      .lean();
    if (!doc) throw new NotFoundException('Message not found');
    return { doc, conversation, member };
  }

  async enqueueReceipt(actor: string, input: ReceiptInput, kind: ReceiptEvent['kind']) {
    await this.target(actor, input);
    await this.bus.publish(topics.receipts, input.conversationId, {
      ...input,
      kind,
      userId: actor,
      correlationId: randomUUID(),
    });
    return true as const;
  }
  private unread(
    actor: string,
    conversationId: string,
    after: Types.ObjectId | undefined,
    sequence: number | undefined,
    session: ClientSession,
  ) {
    return this.model
      .countDocuments({
        conversationId,
        senderId: trusted({ $ne: actor }),
        deletedForEveryone: false,
        deletedFor: trusted({ $ne: actor }),
        ...(sequence !== undefined
          ? { sequence: trusted({ $gt: sequence }) }
          : after
            ? {
                $or: [
                  { sequence: trusted({ $exists: true }) },
                  { sequence: trusted({ $exists: false }), _id: trusted({ $gt: after }) },
                ],
              }
            : {}),
      })
      .session(session);
  }
  async receipt(event: ReceiptEvent) {
    const result = await this.mongo.transaction(async (session) => {
      const conversation = await this.conversationModel
        .findById(event.conversationId)
        .session(session)
        .lean();
      if (
        !conversation ||
        !conversation.members.some((item) => String(item.userId) === event.userId)
      )
        return;
      const { doc, member } = await this.target(event.userId, event, session);
      const sender = String(doc.senderId);
      const notify =
        sender !== event.userId && doc.recipients.some((id) => String(id) === event.userId);
      const wasDelivered = doc.deliveredTo.some((id) => String(id) === event.userId);
      if (notify) {
        const userId = objectId(event.userId);
        await this.model.updateOne(
          { _id: doc._id },
          {
            $addToSet: {
              deliveredTo: userId,
              ...(event.kind === 'read' ? { readBy: userId } : {}),
            },
          },
          { session },
        );
      }
      const advances =
        doc.sequence !== undefined
          ? doc.sequence > (member.lastReadSequence ?? 0)
          : member.lastReadSequence === undefined &&
            (!member.lastReadMessageId || String(member.lastReadMessageId) < event.messageId);
      if (event.kind === 'read' && advances) {
        const unread = await this.unread(
          event.userId,
          event.conversationId,
          doc._id,
          doc.sequence,
          session,
        );
        await this.conversationModel.updateOne(
          { _id: event.conversationId, 'members.userId': event.userId },
          {
            $set: {
              'members.$.lastReadMessageId': doc._id,
              'members.$.unreadCount': unread,
              ...(doc.sequence !== undefined ? { 'members.$.lastReadSequence': doc.sequence } : {}),
            },
          },
          { session },
        );
      }
      return { sender, notify, newDelivery: notify && !wasDelivered };
    });
    if (!result) return;
    if (result.newDelivery) this.metrics.messages.inc({ stage: 'delivered' });
    if (event.kind === 'read') {
      await this.conversations.invalidate([event.userId], undefined, event.conversationId);
      this.broadcast
        .user(event.userId)
        .emit(events.conversation, { conversationId: event.conversationId });
    }
    if (result.notify) {
      const update: ReceiptUpdate = {
        conversationId: event.conversationId,
        messageId: event.messageId,
        userId: event.userId,
        kind: event.kind,
      };
      this.broadcast.user(result.sender).emit(events.receipt, update);
    }
  }

  async remove(actor: string, messageId: string, forEveryone: boolean) {
    const initial = await this.model.findById(messageId).select('conversationId').lean();
    if (!initial) throw new NotFoundException('Message not found');
    const conversationId = String(initial.conversationId);
    const recipients = await this.mongo.transaction(async (session) => {
      const { doc, conversation } = await this.target(
        actor,
        { conversationId, messageId },
        session,
      );
      requireMembership(conversation, actor);
      if (forEveryone) {
        if (String(doc.senderId) !== actor)
          throw new ForbiddenException('Only the sender can delete this message for everyone');
        if (
          !doc.deletedForEveryone &&
          Date.now() - doc.createdAt.getTime() > this.env.DELETE_WINDOW_SECONDS * 1000
        ) {
          throw new ForbiddenException('The delete window has closed');
        }
        await this.model.updateOne(
          { _id: doc._id },
          { $set: { deletedForEveryone: true }, $unset: { body: 1, media: 1 } },
          { session },
        );
        if (conversation.lastMessage?.messageId === messageId) {
          await this.conversationModel.updateOne(
            { _id: conversationId },
            { $set: { lastMessage: messageView({ ...doc, deletedForEveryone: true }) } },
            { session },
          );
        }
      } else {
        await this.model.updateOne(
          { _id: doc._id },
          { $addToSet: { deletedFor: objectId(actor) } },
          { session },
        );
      }
      const affected = conversation.members.filter(
        (member) => forEveryone || String(member.userId) === actor,
      );
      for (const member of affected) {
        const id = String(member.userId);
        const unread = await this.unread(
          id,
          conversationId,
          member.lastReadMessageId,
          member.lastReadSequence,
          session,
        );
        await this.conversationModel.updateOne(
          { _id: conversationId, 'members.userId': id },
          { $set: { 'members.$.unreadCount': unread } },
          { session },
        );
      }
      return affected.map((member) => String(member.userId));
    });
    await this.conversations.invalidate(recipients, undefined, conversationId);
    const update: DeletedMessage = { conversationId, messageId, forEveryone };
    this.broadcast.users(recipients).emit(events.deleted, update);
    this.broadcast.users(recipients).emit(events.conversation, { conversationId });
  }
}
