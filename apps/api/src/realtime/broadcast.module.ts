import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module.js';
import { RealtimeBroadcastService } from './broadcast.service.js';

@Module({
  imports: [RedisModule],
  providers: [RealtimeBroadcastService],
  exports: [RealtimeBroadcastService],
})
export class BroadcastModule {}
