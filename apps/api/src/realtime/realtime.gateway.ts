import {
  HttpException,
  Inject,
  UnauthorizedException,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { WebSocketGateway, type OnGatewayInit, type OnGatewayConnection } from '@nestjs/websockets';
import { randomUUID } from 'node:crypto';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, Socket } from 'socket.io';
import type { ZodType } from 'zod';
import { z } from 'zod';
import {
  conversationSchema,
  events,
  receiptInput,
  rooms,
  sendSchema,
  type Ack,
} from '@relay/shared';
import { AuthService } from '../auth/auth.service.js';
import { parse } from '../common/http/schema.pipe.js';
import { publicError } from '../common/http/public-error.js';
import { type Actor } from '../common/http/actor.js';
import { ENV, type Env } from '../config/environment.js';
import { ConversationMembershipService } from '../conversations/conversation-membership.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { PresenceService } from '../presence/presence.service.js';
import { RedisService } from '../redis/redis.service.js';
import { PinoLogger } from 'nestjs-pino';
type RelaySocket = Socket & { data: { actor: Actor; ip: string } };
type Reply<T> = (ack: Ack<T>) => void;
const empty = z.strictObject({});

@WebSocketGateway({ maxHttpBufferSize: 20 * 1024, transports: ['websocket'], serveClient: false })
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, BeforeApplicationShutdown
{
  private readonly subscriber;
  private readonly disconnected = new Set<Promise<void>>();
  private server?: Server;
  private draining = false;
  constructor(
    private readonly auth: AuthService,
    private readonly membership: ConversationMembershipService,
    private readonly presence: PresenceService,
    private readonly messages: MessagesService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.subscriber = redis.client.duplicate({ commandTimeout: undefined, autoResubscribe: true });
    this.subscriber.on('error', () => undefined);
  }
  afterInit(server: Server) {
    this.server = server;
    server.adapter(createAdapter(this.redis.client, this.subscriber));
    server.use(async (socket, next) => {
      try {
        const origin = socket.handshake.headers.origin;
        if (this.draining || (origin && !this.env.CORS_ORIGINS.includes(origin)))
          throw new UnauthorizedException();
        const forwarded = socket.handshake.headers['x-forwarded-for'];
        const chain =
          typeof forwarded === 'string' ? forwarded.split(',').map((ip) => ip.trim()) : [];
        const ip =
          (this.env.TRUST_PROXY > 0 ? chain.at(-this.env.TRUST_PROXY) : undefined) ??
          socket.handshake.address;
        await this.redis.rate('socket:connect:' + ip, 120, 60000, randomUUID());
        const token = (socket.handshake.auth as Record<string, unknown>).token;
        if (typeof token !== 'string' || token.length > 4096) throw new UnauthorizedException();
        socket.data = { ip, actor: await this.auth.authenticate(token) };
        next();
      } catch (error) {
        const value = publicError(error);
        next(Object.assign(new Error(value.message), { data: value }));
      }
    });
  }
  async handleConnection(socket: RelaySocket) {
    const { sub, exp } = socket.data.actor;
    this.metrics.sockets.inc();
    const expires = setTimeout(
      () => {
        socket.emit(events.error, { code: 'UNAUTHORIZED', message: 'Access token expired' });
        socket.disconnect(true);
      },
      Math.max(1, exp * 1000 - Date.now()),
    );
    socket.once('disconnect', () => {
      this.metrics.sockets.dec();
      clearTimeout(expires);
      const task = this.presence.lost(sub, socket.id).catch(() => {
        this.logger.warn('Socket presence removal failed');
      });
      this.disconnected.add(task);
      void task.finally(() => this.disconnected.delete(task));
    });

    const ready = this.initialize(socket, sub).catch(() => {
      socket.emit(events.error, {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Unable to initialize chat connection',
      });
      socket.disconnect(true);
      return false;
    });
    const bind = <I, O>(event: string, schema: ZodType<I>, action: (input: I) => Promise<O>) => {
      socket.on(event, (value: unknown, reply?: Reply<O>) => {
        if (typeof reply !== 'function') return;
        void (async () => {
          try {
            if (!(await ready) || this.draining)
              throw new HttpException('Connection unavailable', 503);
            const nonce = randomUUID();
            await this.redis.rate('socket:ip:' + socket.data.ip, 900, 60000, nonce);
            await this.redis.rate('socket:user:' + sub, 480, 60000, nonce);
            if (event === events.send)
              await this.redis.rate('socket:send:' + sub, 60, 60000, nonce);
            await this.auth.assertActive(socket.data.actor);
            reply(await action(parse(schema, value)));
          } catch (error) {
            if (!(error instanceof HttpException))
              this.logger.warn({ event }, 'Socket operation failed');
            reply({ ok: false, error: publicError(error) });
          }
        })();
      });
    };
    bind(events.send, sendSchema, (data) => this.messages.send(sub, data));
    bind(events.delivered, receiptInput, (data) =>
      this.messages.enqueueReceipt(sub, data, 'delivered'),
    );
    bind(events.read, receiptInput, (data) => this.messages.enqueueReceipt(sub, data, 'read'));
    bind(events.join, conversationSchema, async ({ conversationId }) => {
      const { doc } = await this.membership.authorize(conversationId, sub);
      await socket.join(rooms.conversation(conversationId));
      for (const info of await this.presence.snapshot(
        doc.members.map((member) => String(member.userId)),
      ))
        socket.emit(events.presence, info);
      return true;
    });
    bind(events.typingStart, conversationSchema, async ({ conversationId }) => {
      await this.presence.typing(conversationId, sub, true);
      return true;
    });
    bind(events.typingStop, conversationSchema, async ({ conversationId }) => {
      await this.presence.typing(conversationId, sub, false);
      return true;
    });
    bind(events.ping, empty, async () => {
      await this.presence.heartbeat(sub, socket.id);
      return true;
    });
  }
  private async initialize(socket: RelaySocket, id: string) {
    await socket.join([rooms.user(id), rooms.session(socket.data.actor.sid)]);
    await this.auth.assertActive(socket.data.actor);
    const docs = await this.membership.roomsFor(id);
    await socket.join(docs.map((doc) => rooms.conversation(String(doc._id))));
    await this.presence.heartbeat(id, socket.id);
    if (!socket.connected) {
      await this.presence.lost(id, socket.id);
      return false;
    }
    const users = docs.flatMap((doc) => doc.members.map((member) => String(member.userId)));
    for (const info of await this.presence.snapshot(users)) socket.emit(events.presence, info);
    return true;
  }
  async beforeApplicationShutdown() {
    this.draining = true;
    this.server?.local.disconnectSockets(true);
    await Promise.allSettled([...this.disconnected]);
    this.subscriber.disconnect();
  }
}
