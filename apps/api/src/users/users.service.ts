import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Me, User } from '@relay/shared';
import { trusted, type Model } from 'mongoose';
import { z } from 'zod';
import { models } from '../database/model-names.js';
import { type UserDoc } from './user.schema.js';
import { RedisService } from '../redis/redis.service.js';
import { profileSchema } from './users.dto.js';
export function userView(doc: UserDoc): User {
  return {
    id: String(doc._id),
    username: doc.username,
    displayName: doc.displayName,
    avatarKey: doc.avatarKey,
    about: doc.about,
    lastSeenAt: doc.lastSeenAt?.toISOString(),
  };
}
export function meView(doc: UserDoc): Me {
  return { ...userView(doc), email: doc.email };
}
@Injectable()
export class UsersService {
  constructor(
    @InjectModel(models.user) private readonly users: Model<UserDoc>,
    private readonly redis: RedisService,
  ) {}
  async create(profile: Pick<UserDoc, 'username' | 'displayName' | 'email' | 'passwordHash'>) {
    const user = await this.users.create(profile);
    return String(user._id);
  }
  credentials(login: string) {
    return this.users
      .findOne({ $or: [{ email: login }, { username: login }] })
      .select('+passwordHash')
      .lean();
  }
  async ensureUser(
    profile: Pick<UserDoc, 'username' | 'displayName' | 'email' | 'passwordHash' | 'about'>,
  ) {
    const user = await this.users
      .findOneAndUpdate(
        { username: profile.username },
        { $setOnInsert: profile },
        { upsert: true, returnDocument: 'after' },
      )
      .lean()
      .orFail();
    return String(user._id);
  }
  async recordLastSeen(id: string, lastSeenAt: Date) {
    await this.users.updateOne({ _id: id }, { $max: { lastSeenAt } });
    await this.redis.client.del(`profile:${id}`);
  }
  async me(id: string) {
    const user = await this.users.findById(id).lean();
    if (!user) throw new NotFoundException('User not found');
    return meView(user);
  }
  async profiles(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, User>();
    const keys = unique.map((id) => `profile:${id}`);
    const cached = await this.redis.client.mget(...keys);
    const profiles = new Map<string, User>();
    const missing = unique.filter((id, index) => {
      const raw = cached[index];
      if (raw) profiles.set(id, JSON.parse(raw) as User);
      return !raw;
    });
    if (missing.length) {
      const found = await this.users.find({ _id: trusted({ $in: missing }) }).lean();
      await Promise.all(
        found.map((doc) => {
          const profile = userView(doc);
          profiles.set(profile.id, profile);
          return this.redis.put(`profile:${profile.id}`, profile, 60);
        }),
      );
    }
    return profiles;
  }
  async update(id: string, input: z.infer<typeof profileSchema>) {
    const updated = await this.users
      .findByIdAndUpdate(id, { $set: input }, { returnDocument: 'after' })
      .lean();
    if (!updated) throw new NotFoundException('User not found');
    await this.redis.client.del(`profile:${id}`);
    return meView(updated);
  }
  async search(id: string, q: string) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('^' + escaped, 'i');
    const docs = await this.users
      .find({ _id: trusted({ $ne: id }), $or: [{ username: pattern }, { displayName: pattern }] })
      .sort({ username: 1 })
      .limit(20)
      .lean();
    return docs.map(userView);
  }
}
