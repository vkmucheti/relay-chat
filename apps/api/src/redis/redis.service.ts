import { HttpException, Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../config/environment.js';

const windowScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}
`;

const slidingScript = `
local time = redis.call('TIME')
local now = time[1] * 1000 + math.floor(time[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - tonumber(ARGV[1]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return 1
`;
@Injectable()
export class RedisService implements OnApplicationShutdown {
  readonly client: Redis;
  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      connectTimeout: 3000,
      commandTimeout: 3000,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(250 * attempt, 3000),
    });
    this.client.on('error', () => undefined);
  }
  async rate(key: string, limit: number, ms: number, nonce: string) {
    if ((await this.client.eval(slidingScript, 1, `rate:${key}`, ms, limit, nonce)) !== 1) {
      throw new HttpException('Too many requests. Try again shortly.', 429);
    }
  }
  async throttle(key: string, ttl: number, limit: number, blockDuration: number) {
    const [totalHits, timeToExpire] = (await this.client.eval(
      windowScript,
      1,
      `rate:http:${key}`,
      ttl,
    )) as [number, number];
    const blockKey = `rate:block:${key}`;
    if (totalHits === limit + 1) await this.client.set(blockKey, '1', 'PX', blockDuration);
    const block = await this.client.pttl(blockKey);
    return {
      totalHits,
      timeToExpire: Math.ceil(timeToExpire / 1000),
      isBlocked: totalHits > limit || block > 0,
      timeToBlockExpire: Math.ceil(Math.max(block, 0) / 1000),
    };
  }
  async put(key: string, value: unknown, ttl: number) {
    await this.client.set(key, JSON.stringify(value), 'EX', ttl);
  }
  onApplicationShutdown() {
    this.client.disconnect();
  }
}
