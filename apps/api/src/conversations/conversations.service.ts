import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { type Conversation, type Page } from '@relay/shared';
import { trusted, type Connection, type Model, type QueryFilter } from 'mongoose';
import type { z } from 'zod';
import { parse } from '../common/http/schema.pipe.js';
import { duplicate, objectId } from '../database/mongo.js';
import { models } from '../database/model-names.js';
import { type ConversationDoc, type MemberDoc } from './conversation.schema.js';
import { type MessageDoc } from '../messages/message.schema.js';
import { RedisService } from '../redis/redis.service.js';
import { RealtimeBroadcastService } from '../realtime/broadcast.service.js';
import { UsersService } from '../users/users.service.js';
import {
  cursorSchema,
  encodeCursor,
  groupInput,
  pageInput,
  updateInput,
} from './conversations.dto.js';
import { ConversationMembershipService } from './conversation-membership.service.js';
const conversationCache = (userId: string) => `conversations:recent:${userId}`;
const versionKey = (userId: string) => `conversations:version:${userId}`;
const unreadKey = (userId: string, conversationId: string) => `unread:${userId}:${conversationId}`;
const writePage = `
local version = redis.call('GET', KEYS[1]) or '0'
if version ~= ARGV[1] then return 0 end
for i=2,#KEYS do redis.call('SET', KEYS[i], ARGV[i], 'EX', 12) end
return 1
`;
@Injectable()
export class ConversationsService {
  constructor(
    private readonly membership: ConversationMembershipService,
    @InjectModel(models.conversation) private readonly model: Model<ConversationDoc>,
    private readonly users: UsersService,
    private readonly redis: RedisService,
    private readonly broadcast: RealtimeBroadcastService,
    @InjectConnection() private readonly mongo: Connection,
    @InjectModel(models.message) private readonly messages: Model<MessageDoc>,
  ) {}

  private member(userId: string, role: MemberDoc['role'] = 'member'): MemberDoc {
    return { userId: objectId(userId), role, joinedAt: new Date(), unreadCount: 0 };
  }
  async invalidate(userIds: string[], id?: string, unreadId = id) {
    await Promise.all([
      ...(id ? [this.membership.invalidate(id)] : []),
      ...userIds.map((userId) =>
        this.redis.client
          .multi()
          .incr(versionKey(userId))
          .expire(versionKey(userId), 90)
          .del(conversationCache(userId), ...(unreadId ? [unreadKey(userId, unreadId)] : []))
          .exec(),
      ),
    ]);
  }
  private async view(docs: ConversationDoc[], userId: string): Promise<Conversation[]> {
    const [profiles, hidden] = await Promise.all([
      this.users.profiles(
        docs.flatMap((doc) => doc.members.map((member) => String(member.userId))),
      ),
      this.messages
        .find({
          _id: trusted({
            $in: docs.flatMap((doc) => (doc.lastMessage ? [doc.lastMessage.messageId] : [])),
          }),
          deletedFor: objectId(userId),
        })
        .select('_id')
        .lean(),
    ]);
    const hiddenIds = new Set(hidden.map((doc) => String(doc._id)));
    return docs.map((doc) => {
      const member = doc.members.find((item) => String(item.userId) === userId);
      return {
        id: String(doc._id),
        type: doc.type,
        name: doc.name,
        avatarKey: doc.avatarKey,
        createdBy: String(doc.createdBy),
        members: doc.members.flatMap((item) => {
          const id = String(item.userId);
          const user = profiles.get(id);
          return user ? [{ user, role: item.role, joinedAt: item.joinedAt.toISOString() }] : [];
        }),
        unreadCount: member?.unreadCount ?? 0,
        lastReadMessageId: member?.lastReadMessageId?.toString(),
        lastMessage:
          doc.lastMessage && !hiddenIds.has(doc.lastMessage.messageId)
            ? doc.lastMessage
            : undefined,
        updatedAt: doc.updatedAt.toISOString(),
      };
    });
  }
  async findGroupId(createdBy: string, name: string) {
    const group = await this.model.findOne({ type: 'group', createdBy, name }).select('_id').lean();
    return group?._id.toString();
  }
  async one(id: string, userId: string) {
    const { doc } = await this.membership.authorize(id, userId);
    return (await this.view([doc], userId))[0];
  }
  async list(
    actor: string,
    { cursor, limit }: z.infer<typeof pageInput>,
  ): Promise<Page<Conversation>> {
    const key = conversationCache(actor);
    const cacheable = !cursor && limit === 30;
    let version: string | null = null;
    if (cacheable) {
      const [cached, generation] = await this.redis.client.mget(key, versionKey(actor));
      version = generation;
      if (cached) {
        const page = JSON.parse(cached) as Page<Conversation>;
        if (page.items.length) {
          const counts = await this.redis.client.mget(
            ...page.items.map((item) => unreadKey(actor, item.id)),
          );
          for (const [index, item] of page.items.entries())
            if (counts[index] !== null) item.unreadCount = Number(counts[index]);
        }
        return page;
      }
    }
    const filter: QueryFilter<ConversationDoc> = { 'members.userId': objectId(actor) };
    if (cursor) {
      let raw: unknown;
      try {
        raw = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      } catch {
        throw new BadRequestException('Invalid conversation cursor');
      }
      const position = parse(cursorSchema, raw);
      const at = new Date(position.at);
      filter.$or = [
        { updatedAt: trusted({ $lt: at }) },
        { updatedAt: at, _id: trusted({ $lt: objectId(position.id) }) },
      ];
    }
    const found = await this.model
      .find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const docs = found.slice(0, limit);
    const items = await this.view(docs, actor);
    const last = docs.at(-1);
    const page = {
      items,
      nextCursor:
        last && found.length > limit ? encodeCursor(last.updatedAt, String(last._id)) : undefined,
    };
    if (cacheable) {
      const keys = [versionKey(actor), key, ...items.map((item) => unreadKey(actor, item.id))];
      await this.redis.client.eval(
        writePage,
        keys.length,
        ...keys,
        version ?? '0',
        JSON.stringify(page),
        ...items.map((item) => item.unreadCount),
      );
    }
    return page;
  }
  private async assertUsers(ids: string[]) {
    const profiles = await this.users.profiles(ids);
    if (profiles.size !== ids.length)
      throw new NotFoundException('One or more users were not found');
  }
  async direct(actor: string, userId: string) {
    if (actor === userId) throw new BadRequestException('Choose another user');
    const ids = [actor, userId].sort();
    await this.assertUsers(ids);
    const directKey = ids.join(':');
    const filter = { type: 'direct' as const, directKey };
    let doc: ConversationDoc | null;
    try {
      doc = await this.model
        .findOneAndUpdate(
          filter,
          {
            $setOnInsert: { members: ids.map((id) => this.member(id)), createdBy: objectId(actor) },
          },
          { upsert: true, returnDocument: 'after' },
        )
        .lean();
    } catch (error) {
      if (!duplicate(error)) throw error;
      doc = await this.model.findOne(filter).lean();
    }
    if (!doc) throw new ConflictException('Could not open direct conversation');
    const id = String(doc._id);
    await this.invalidate(ids, id);
    this.broadcast.membership(id, ids);
    return (await this.view([doc], actor))[0];
  }
  async group(actor: string, { name, userIds, avatarKey }: z.infer<typeof groupInput>) {
    const others = userIds.filter((id) => id !== actor);
    if (!others.length) throw new BadRequestException('Add at least one other person');
    await this.assertUsers(others);
    const members = [this.member(actor, 'admin'), ...others.map((id) => this.member(id))];
    const doc = (
      await this.model.create({
        type: 'group',
        members,
        name,
        avatarKey,
        createdBy: objectId(actor),
      })
    ).toObject();
    const id = String(doc._id);
    await this.invalidate([actor, ...others], id);
    this.broadcast.membership(id, [actor, ...others]);
    return (await this.view([doc], actor))[0];
  }
  async update(actor: string, id: string, { name, avatarKey }: z.infer<typeof updateInput>) {
    const doc = await this.model
      .findOneAndUpdate(
        {
          _id: id,
          type: 'group',
          members: trusted({ $elemMatch: { userId: objectId(actor), role: 'admin' } }),
        },
        {
          $set: {
            ...(name ? { name } : {}),
            ...(avatarKey ? { avatarKey } : {}),
            updatedAt: new Date(),
          },
          ...(avatarKey === null ? { $unset: { avatarKey: 1 } } : {}),
        },
        { returnDocument: 'after' },
      )
      .lean();
    if (!doc) {
      await this.membership.authorize(id, actor, { admin: true });
      throw new ConflictException('Group changed. Try again.');
    }
    const ids = doc.members.map((item) => String(item.userId));
    await this.invalidate(ids, id);
    this.broadcast.membership(id, ids);
    return (await this.view([doc], actor))[0];
  }
  async changeMembers(
    actor: string,
    id: string,
    userIds: string[],
    mode: 'add' | 'remove' | 'leave',
  ) {
    if (mode === 'add') await this.assertUsers(userIds);
    const result = await this.mongo.transaction(async (session) => {
      const { doc } = await this.membership.authorize(id, actor, {
        admin: mode !== 'leave',
        session,
      });
      if (doc.type !== 'group') throw new BadRequestException('Only group members can leave');
      const existing = new Set(doc.members.map((item) => String(item.userId)));
      const members =
        mode === 'add'
          ? [
              ...doc.members,
              ...userIds.filter((item) => !existing.has(item)).map((item) => this.member(item)),
            ]
          : doc.members.filter((item) => !userIds.includes(String(item.userId)));
      if (members.length > 50) throw new BadRequestException('Groups support up to 50 members');
      if (members.length && !members.some((item) => item.role === 'admin'))
        members[0].role = 'admin';
      const ids = members.map((item) => String(item.userId));
      const removed = [...existing].filter((item) => !ids.includes(item));
      await this.model.updateOne(
        { _id: id },
        { $set: { members, updatedAt: new Date() } },
        { session },
      );
      return { ids, removed };
    });
    await this.invalidate([...result.ids, ...result.removed], id);
    this.broadcast.membership(id, result.ids, result.removed);
    return { ok: true };
  }
}
