import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigurationModule } from '../config/configuration.module.js';
import type { Env } from '../config/environment.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({})
export class SeedModule {
  static register(env: Env): DynamicModule {
    return {
      module: SeedModule,
      imports: [
        ConfigurationModule.register(env),
        DatabaseModule,
        UsersModule,
        ConversationsModule,
        MessagesModule,
      ],
    };
  }
}
