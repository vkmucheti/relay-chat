import { Schema, type Types } from 'mongoose';
import type { Message } from '@relay/shared';
import { models } from '../database/model-names.js';
import { oid, ref } from '../database/mongo.js';
export interface MemberDoc {
  userId: Types.ObjectId;
  role: 'admin' | 'member';
  joinedAt: Date;
  lastReadMessageId?: Types.ObjectId;
  lastReadSequence?: number;
  unreadCount: number;
}
export interface ConversationDoc {
  _id: Types.ObjectId;
  type: 'direct' | 'group';
  members: MemberDoc[];
  name?: string;
  avatarKey?: string;
  createdBy: Types.ObjectId;
  directKey?: string;
  lastMessage?: Message;
  messageSequence?: number;
  updatedAt: Date;
}
const member = new Schema<MemberDoc>(
  {
    userId: ref(models.user),
    role: { type: String, enum: ['admin', 'member'], required: true },
    joinedAt: { type: Date, required: true },
    lastReadMessageId: oid,
    lastReadSequence: Number,
    unreadCount: { type: Number, default: 0 },
  },
  { _id: false },
);
export const conversationSchema = new Schema<ConversationDoc>({
  type: { type: String, enum: ['direct', 'group'], required: true },
  members: { type: [member], required: true },
  name: String,
  avatarKey: String,
  createdBy: ref(models.user),
  directKey: { type: String, unique: true, sparse: true },
  lastMessage: Schema.Types.Mixed,
  messageSequence: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
});
conversationSchema.index({ 'members.userId': 1, updatedAt: -1, _id: -1 });
