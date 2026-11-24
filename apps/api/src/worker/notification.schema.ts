import { Schema, type Types } from 'mongoose';
import { models } from '../database/model-names.js';
import { ref } from '../database/mongo.js';
export interface NotificationDoc {
  userId: Types.ObjectId;
  messageId: Types.ObjectId;
  conversationId: Types.ObjectId;
  createdAt: Date;
}
export const notificationSchema = new Schema<NotificationDoc>({
  userId: ref(models.user),
  messageId: ref(models.message),
  conversationId: ref(models.conversation),
  createdAt: { type: Date, default: Date.now },
});
notificationSchema.index({ userId: 1, messageId: 1 }, { unique: true });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });
