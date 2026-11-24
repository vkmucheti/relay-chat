import { UsersService } from '../users/users.service.js';
import {
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { events, type PresenceUpdate, type TypingUpdate } from '@relay/shared';
import { PinoLogger } from 'nestjs-pino';
import { ENV, type Env } from '../config/environment.js';
import { ConversationMembershipService } from '../conversations/conversation-membership.service.js';
import { RealtimeBroadcastService } from '../realtime/broadcast.service.js';
import { RedisService } from '../redis/redis.service.js';
const due = 'presence:due';
export const presenceKey = (id: string) => `presence:user:${id}`;
export const expiryScore = (now: number, ttlSeconds: number) => now + ttlSeconds * 1000;
const touch = `
local now=tonumber(ARGV[1])
local before=redis.call('ZCOUNT', KEYS[1], '(' .. now, '+inf')
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
local latest=redis.call('ZRANGE', KEYS[1], -1, -1, 'WITHSCORES')
redis.call('ZADD', KEYS[2], latest[2], ARGV[5])
return before
`;
const remove = `
local observed=redis.call('ZSCORE', KEYS[2], ARGV[3])
if not observed then return 0 end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if ARGV[2] ~= '' then redis.call('ZREM', KEYS[1], ARGV[2]) end
local remaining=redis.call('ZRANGE', KEYS[1], -1, -1, 'WITHSCORES')
if #remaining>0 then
  redis.call('ZADD', KEYS[2], remaining[2], ARGV[3])
  return 0
end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[3])
return 1
`;

@Injectable()
export class PresenceService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private sweeping = false;
  constructor(
    private readonly redis: RedisService,
    private readonly membership: ConversationMembershipService,
    private readonly broadcast: RealtimeBroadcastService,
    private readonly users: UsersService,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {}
  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.sweep(), 5000);
    this.timer.unref();
  }
  beforeApplicationShutdown() {
    clearInterval(this.timer);
  }
  async heartbeat(id: string, socketId: string) {
    const now = Date.now();
    const count = await this.redis.client.eval(
      touch,
      2,
      presenceKey(id),
      due,
      now,
      expiryScore(now, this.env.PRESENCE_TTL_SECONDS),
      socketId,
      this.env.PRESENCE_TTL_SECONDS * 2000,
      id,
    );
    if (count === 0) await this.publish({ userId: id, online: true });
  }
  async lost(id: string, socketId = '') {
    const now = Date.now();
    if ((await this.redis.client.eval(remove, 2, presenceKey(id), due, now, socketId, id)) !== 1)
      return;
    const lastSeen = new Date(now);
    await this.users.recordLastSeen(id, lastSeen);
    if (!(await this.online(id)))
      await this.publish({ userId: id, online: false, lastSeenAt: lastSeen.toISOString() });
  }
  async online(id: string) {
    return (await this.redis.client.zcount(presenceKey(id), Date.now() + 1, '+inf')) > 0;
  }
  async snapshot(ids: string[]) {
    const unique = [...new Set(ids)];
    const results = await Promise.all(
      unique.map(async (userId) => ({ userId, online: await this.online(userId) })),
    );
    return results;
  }
  private async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const users = await this.redis.client.zrangebyscore(due, '-inf', Date.now(), 'LIMIT', 0, 200);
      await Promise.all(users.map((id) => this.lost(id)));
    } catch {
      this.logger.warn('Presence expiration sweep failed');
    } finally {
      this.sweeping = false;
    }
  }
  private async publish(info: PresenceUpdate) {
    const docs = await this.membership.roomsFor(info.userId);
    const audience = [
      ...new Set(docs.flatMap((doc) => doc.members.map((member) => String(member.userId)))),
    ];
    if (audience.length) this.broadcast.users(audience).emit(events.presence, info);
  }
  async typing(conversationId: string, userId: string, typing: boolean) {
    await this.membership.authorize(conversationId, userId);
    const key = `typing:${conversationId}:${userId}`;
    if (typing) await this.redis.client.set(key, '1', 'EX', 5);
    else await this.redis.client.del(key);
    const update: TypingUpdate = { conversationId, userId, typing };
    this.broadcast.conversation(conversationId).emit(events.typing, update);
  }
}
