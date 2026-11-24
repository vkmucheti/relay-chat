import { Schema, type Types } from 'mongoose';
import { models } from '../database/model-names.js';
import { ref } from '../database/mongo.js';
export interface SessionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  currentHash: string;
  expiresAt: Date;
  revokedAt?: Date;
}
export const sessionSchema = new Schema<SessionDoc>({
  userId: ref(models.user),
  currentHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  revokedAt: Date,
});
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
