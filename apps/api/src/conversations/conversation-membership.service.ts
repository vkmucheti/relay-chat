import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import { models } from '../database/model-names.js';
import { type ConversationDoc } from './conversation.schema.js';
import { RedisService } from '../redis/redis.service.js';

export function requireMembership(doc: ConversationDoc | null, userId: string, admin = false) {
  const member = doc?.members.find((item) => String(item.userId) === userId);
  if (!doc || !member) throw new NotFoundException('Conversation not found');
  if (admin && (doc.type !== 'group' || member.role !== 'admin'))
    throw new ForbiddenException('Group admins only');
  return member;
}
const replaceMembers = `
local version = redis.call('GET', KEYS[1]) or '0'
if version ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[2])
redis.call('SADD', KEYS[2], '_')
for i=2,#ARGV do redis.call('SADD', KEYS[2], ARGV[i]) end
redis.call('EXPIRE', KEYS[2], 30)
return 1
`;
const invalidateMembers = `
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 90)
redis.call('DEL', KEYS[2])
`;
@Injectable()
export class ConversationMembershipService {
  constructor(
    @InjectModel(models.conversation) private readonly model: Model<ConversationDoc>,
    private readonly redis: RedisService,
  ) {}
  async authorize(
    id: string,
    userId: string,
    options: { admin?: boolean; session?: ClientSession } = {},
  ) {
    const doc = await this.model
      .findById(id)
      .session(options.session ?? null)
      .lean();
    const member = requireMembership(doc, userId, options.admin);
    if (!doc) throw new NotFoundException('Conversation not found');
    return { doc, member };
  }
  async cached(id: string, userId: string) {
    const set = `members:${id}`;
    const version = `members:version:${id}`;
    const state = await this.redis.client
      .multi()
      .exists(set)
      .sismember(set, userId)
      .get(version)
      .exec();
    if (state?.[0][1] === 1) {
      if (state[1][1] !== 1) throw new NotFoundException('Conversation not found');
      return;
    }
    const doc = await this.model.findById(id).lean();
    requireMembership(doc, userId);
    if (doc)
      await this.redis.client.eval(
        replaceMembers,
        2,
        version,
        set,
        String(state?.[2][1] ?? '0'),
        ...doc.members.map((member) => String(member.userId)),
      );
  }
  invalidate(id: string) {
    return this.redis.client.eval(invalidateMembers, 2, `members:version:${id}`, `members:${id}`);
  }
  async memberIds(conversationId: string) {
    const doc = await this.model.findById(conversationId).select('members').lean();
    return doc?.members.map((member) => String(member.userId));
  }
  roomsFor(userId: string) {
    return this.model.find({ 'members.userId': userId }).select('members').lean();
  }
}
