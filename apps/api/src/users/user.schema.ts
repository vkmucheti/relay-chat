import { Schema, type Types } from 'mongoose';
export interface UserDoc {
  _id: Types.ObjectId;
  username: string;
  email: string;
  passwordHash: string;
  displayName: string;
  avatarKey?: string;
  about?: string;
  lastSeenAt?: Date;
  createdAt: Date;
}
export const userSchema = new Schema<UserDoc>({
  username: { type: String, unique: true, required: true },
  email: { type: String, unique: true, required: true },
  passwordHash: { type: String, required: true, select: false },
  displayName: { type: String, required: true },
  avatarKey: String,
  about: String,
  lastSeenAt: Date,
  createdAt: { type: Date, default: Date.now },
});
