import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiAuthGuard } from '../auth/api-auth.guard.js';
import { RedisModule } from '../redis/redis.module.js';
import { RedisService } from '../redis/redis.service.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { AuthController } from '../auth/auth.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { UsersController } from '../users/users.controller.js';
import { UsersModule } from '../users/users.module.js';
import { ContactsController } from '../contacts/contacts.controller.js';
import { ContactsModule } from '../contacts/contacts.module.js';
import { ConversationsController } from '../conversations/conversations.controller.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { MessagesController } from '../messages/messages.controller.js';
import { MessagesModule } from '../messages/messages.module.js';
import { MediaController } from '../media/media.controller.js';
import { MediaModule } from '../media/media.module.js';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    ContactsModule,
    ConversationsModule,
    MessagesModule,
    MediaModule,
    RedisModule,
    RealtimeModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [
          {
            ttl: 60000,
            limit: 240,
            skipIf: (ctx) =>
              ctx.getType() !== 'http' ||
              /^(\/health\/|\/metrics$)/.test(ctx.switchToHttp().getRequest<{ url: string }>().url),
          },
        ],
        storage: {
          increment: (key, ttl, limit, blockDuration) =>
            redis.throttle(key, ttl, limit, blockDuration),
        },
      }),
    }),
  ],
  controllers: [
    AuthController,
    UsersController,
    ContactsController,
    ConversationsController,
    MessagesController,
    MediaController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: ApiAuthGuard },
  ],
})
export class GatewayModule {}
