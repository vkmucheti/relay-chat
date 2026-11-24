import 'reflect-metadata';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { objectId } from '../database/mongo.js';
import { type ConversationDoc } from '../conversations/conversation.schema.js';
import { type ReservationDoc } from '../messages/send-reservation.schema.js';
import { loadEnv } from '../config/environment.js';
import { requireMembership } from '../conversations/conversation-membership.service.js';
import { assertMatchingSend, sendFingerprint } from '../messages/send-idempotency.js';
import { expiryScore, presenceKey } from '../presence/presence.service.js';
import { AuthService } from '../auth/auth.service.js';
import type { Model } from 'mongoose';
import type { SessionDoc } from '../auth/session.schema.js';
import type { RedisService } from '../redis/redis.service.js';
import type { UsersService } from '../users/users.service.js';
import type { RealtimeBroadcastService } from '../realtime/broadcast.service.js';

const alice = '66aa00000000000000000001';
const bob = '66aa00000000000000000002';
const chat = '66aa00000000000000000003';
const sessionId = '66aa00000000000000000004';
const env = loadEnv({
  APP_ENV: 'test',
  CORS_ORIGINS: 'http://localhost:4200',
  JWT_ACCESS_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'b'.repeat(64),
  REDIS_URL: 'redis://localhost:6379',
  MONGO_URL: 'mongodb://localhost/relay',
  KAFKA_BROKERS: 'localhost:9092',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'relay-media',
  S3_ACCESS_KEY: 'access',
  S3_SECRET_KEY: 'local-secret',
});

describe('authentication', () => {
  const jwt = new JwtService();
  it('validates access claims, expiry, token type and Redis revocation', async () => {
    let revoked = 0;
    const redis = { client: { exists: () => Promise.resolve(revoked) } } as unknown as RedisService;
    const auth = new AuthService(
      jwt,
      env,
      { exists: () => Promise.resolve({ _id: sessionId }) } as unknown as Model<SessionDoc>,
      {} as UsersService,
      redis,
      {} as RealtimeBroadcastService,
    );
    const sign = (kind: string, expiresIn: number) =>
      jwt.signAsync(
        { sub: alice, sid: sessionId, kind },
        {
          secret: env.JWT_ACCESS_SECRET,
          issuer: 'relay',
          audience: 'relay-api',
          expiresIn,
        },
      );
    await expect(auth.authenticate(await sign('access', 900))).resolves.toMatchObject({
      sub: alice,
      sid: sessionId,
    });
    await expect(auth.authenticate(await sign('refresh', 900))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(auth.authenticate(await sign('access', -1))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    revoked = 1;
    await expect(auth.authenticate(await sign('access', 900))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
describe('conversation membership', () => {
  const doc: ConversationDoc = {
    _id: objectId(chat),
    type: 'group',
    createdBy: objectId(alice),
    updatedAt: new Date(),
    members: [
      { userId: objectId(alice), role: 'admin', joinedAt: new Date(), unreadCount: 0 },
      { userId: objectId(bob), role: 'member', joinedAt: new Date(), unreadCount: 0 },
    ],
  };
  it('allows members and reserves group changes for admins', () => {
    expect(requireMembership(doc, alice, true).role).toBe('admin');
    expect(requireMembership(doc, bob).role).toBe('member');
    expect(() => requireMembership(doc, bob, true)).toThrow(ForbiddenException);
    expect(() => requireMembership(doc, chat)).toThrow(NotFoundException);
    expect(() => requireMembership({ ...doc, type: 'direct' }, alice, true)).toThrow(
      ForbiddenException,
    );
  });
});
describe('message idempotency', () => {
  it('reuses the canonical event only for an identical retry', () => {
    const input = {
      conversationId: chat,
      clientMessageId: '7ac1f498-4409-40b4-9a90-000000000010',
      type: 'text',
      body: 'First',
    } as const;
    const event = {
      ...input,
      messageId: sessionId,
      senderId: alice,
      createdAt: new Date().toISOString(),
      correlationId: '7ac1f498-4409-40b4-9a90-000000000011',
    };
    const reservation: ReservationDoc = {
      _id: objectId(sessionId),
      senderId: objectId(alice),
      clientMessageId: input.clientMessageId,
      fingerprint: sendFingerprint(input),
      event,
    };
    expect(assertMatchingSend(reservation, sendFingerprint(input))).toBe(event);
    expect(() =>
      assertMatchingSend(reservation, sendFingerprint({ ...input, body: 'Different' })),
    ).toThrow(ConflictException);
    expect(sendFingerprint({ ...input, replyTo: bob })).not.toBe(reservation.fingerprint);
  });
});
describe('presence heartbeats', () => {
  it('extends membership expiry in milliseconds on a per-user sorted set', () => {
    expect(presenceKey(alice)).toBe('presence:user:' + alice);
    expect(expiryScore(1000, 65)).toBe(66000);
    expect(expiryScore(2000, 65)).toBe(67000);
  });
});
