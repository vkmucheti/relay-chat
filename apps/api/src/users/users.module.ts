import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { models } from '../database/model-names.js';
import { RedisModule } from '../redis/redis.module.js';
import { userSchema } from './user.schema.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [MongooseModule.forFeature([{ name: models.user, schema: userSchema }]), RedisModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
