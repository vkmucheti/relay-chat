import { Schema, type Types } from 'mongoose';
import type { Media, Message } from '@relay/shared';
import { models } from '../database/model-names.js';
import { oid, ref } from '../database/mongo.js';
import { attachmentSchema } from '../database/attachment.schema.js';
export interface MessageDoc {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  clientMessageId: string;
  type: Message['type'];
  sequence?: number;
  body?: string;
  media?: Media;
  replyTo?: Types.ObjectId;
  deliveredTo: Types.ObjectId[];
  readBy: Types.ObjectId[];
  deletedForEveryone: boolean;
  deletedFor: Types.ObjectId[];
  createdAt: Date;
  recipients: Types.ObjectId[];
}
export const messageSchema = new Schema<MessageDoc>({
  conversationId: ref(models.conversation),
  senderId: ref(models.user),
  clientMessageId: { type: String, required: true },
  type: { type: String, enum: ['text', 'image', 'file'], required: true },
  sequence: Number,
  body: String,
  media: attachmentSchema,
  replyTo: { type: oid, ref: models.message },
  deliveredTo: [oid],
  readBy: [oid],
  deletedForEveryone: { type: Boolean, default: false },
  deletedFor: [oid],
  createdAt: { type: Date, required: true },
  recipients: [oid],
});
messageSchema.index({ conversationId: 1, _id: -1 });
messageSchema.index({ conversationId: 1, sequence: -1, _id: -1 });
messageSchema.index({ senderId: 1, clientMessageId: 1 }, { unique: true });
messageSchema.index({ 'media.key': 1 });
