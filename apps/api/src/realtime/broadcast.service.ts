import { Injectable } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import { events, rooms, type ConversationUpdate } from '@relay/shared';
import { RedisService } from '../redis/redis.service.js';

@Injectable()
export class RealtimeBroadcastService {
  readonly emitter: Emitter;
  constructor(redis: RedisService) {
    this.emitter = new Emitter(redis.client);
  }
  conversation(id: string) {
    return this.emitter.to(rooms.conversation(id));
  }
  user(id: string) {
    return this.emitter.to(rooms.user(id));
  }
  users(ids: string[]) {
    return this.emitter.to(ids.map(rooms.user));
  }
  membership(id: string, users: string[], removed: string[] = []) {
    for (const user of removed) {
      const target = this.user(user);
      target.socketsLeave(rooms.conversation(id));
      const change: ConversationUpdate = { conversationId: id, removed: true };
      target.emit(events.conversation, change);
    }
    if (users.length) {
      const target = this.users(users);
      target.socketsJoin(rooms.conversation(id));
      const change: ConversationUpdate = { conversationId: id };
      target.emit(events.conversation, change);
    }
  }
}
