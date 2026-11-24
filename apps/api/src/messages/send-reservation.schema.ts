import { Schema, type Types } from 'mongoose';
import type { MessageCreated } from '@relay/shared';
import { models } from '../database/model-names.js';
import { ref } from '../database/mongo.js';
export interface ReservationDoc {
  _id: Types.ObjectId;
  senderId: Types.ObjectId;
  clientMessageId: string;
  fingerprint: string;
  event: MessageCreated;
}
export const reservationSchema = new Schema<ReservationDoc>({
  senderId: ref(models.user),
  clientMessageId: { type: String, required: true },
  fingerprint: { type: String, required: true },
  event: { type: Schema.Types.Mixed, required: true },
});
reservationSchema.index({ senderId: 1, clientMessageId: 1 }, { unique: true });
