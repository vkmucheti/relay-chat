import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Contact } from '@relay/shared';
import type { Model } from 'mongoose';
import { z } from 'zod';
import { duplicate } from '../database/mongo.js';
import { models } from '../database/model-names.js';
import { type ContactDoc } from './contact.schema.js';
import { UsersService } from '../users/users.service.js';
import { input } from './contacts.dto.js';
@Injectable()
export class ContactsService {
  constructor(
    @InjectModel(models.contact) private readonly model: Model<ContactDoc>,
    private readonly users: UsersService,
  ) {}
  async list(ownerId: string): Promise<Contact[]> {
    const docs = await this.model.find({ ownerId }).sort({ _id: -1 }).limit(200).lean();
    const users = await this.users.profiles(docs.map((doc) => String(doc.contactUserId)));
    return docs.flatMap((doc) => {
      const user = users.get(String(doc.contactUserId));
      return user ? [{ id: String(doc._id), user, alias: doc.alias }] : [];
    });
  }
  async save(ownerId: string, { userId, alias }: z.infer<typeof input>): Promise<Contact> {
    if (ownerId === userId) throw new BadRequestException('Choose another user');
    const user = (await this.users.profiles([userId])).get(userId);
    if (!user) throw new NotFoundException('User not found');
    const filter = { ownerId, contactUserId: userId };
    const change = alias ? { $set: { alias } } : { $unset: { alias: 1 } };
    try {
      const result = await this.model
        .findOneAndUpdate(filter, change, { upsert: true, returnDocument: 'after' })
        .lean()
        .orFail();
      return { id: String(result._id), user, alias: result.alias };
    } catch (error) {
      if (!duplicate(error)) throw error;
      const result = await this.model
        .findOneAndUpdate(filter, change, { returnDocument: 'after' })
        .lean()
        .orFail();
      return { id: String(result._id), user, alias: result.alias };
    }
  }
  async delete(ownerId: string, id: string) {
    if (!(await this.model.deleteOne({ _id: id, ownerId })).deletedCount)
      throw new NotFoundException('Contact not found');
  }
}
