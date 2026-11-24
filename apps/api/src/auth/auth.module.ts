import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { models } from '../database/model-names.js';
import { BroadcastModule } from '../realtime/broadcast.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { UsersModule } from '../users/users.module.js';
import { ApiAuthGuard } from './api-auth.guard.js';
import { AuthService } from './auth.service.js';
import { sessionSchema } from './session.schema.js';

@Module({
  imports: [
    JwtModule.register({}),
    MongooseModule.forFeature([{ name: models.session, schema: sessionSchema }]),
    UsersModule,
    RedisModule,
    BroadcastModule,
  ],
  providers: [AuthService, ApiAuthGuard],
  exports: [AuthService, ApiAuthGuard],
})
export class AuthModule {}
