import { Schema, type Types } from 'mongoose';
import type { Media } from '@relay/shared';
import { models } from '../database/model-names.js';
import { ref } from '../database/mongo.js';
import { attachmentSchema } from '../database/attachment.schema.js';
export interface UploadDoc {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  conversationId: Types.ObjectId;
  media: Media;
  createdAt: Date;
}
export const uploadSchema = new Schema<UploadDoc>({
  ownerId: ref(models.user),
  conversationId: ref(models.conversation),
  media: { type: attachmentSchema, required: true },
  createdAt: { type: Date, default: Date.now },
});
uploadSchema.index({ 'media.key': 1 }, { unique: true });
uploadSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });
