import { Schema, type Types } from 'mongoose';
import { models } from '../database/model-names.js';
import { ref } from '../database/mongo.js';
export interface ContactDoc {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  contactUserId: Types.ObjectId;
  alias?: string;
}
export const contactSchema = new Schema<ContactDoc>({
  ownerId: ref(models.user),
  contactUserId: ref(models.user),
  alias: String,
});
contactSchema.index({ ownerId: 1, contactUserId: 1 }, { unique: true });
