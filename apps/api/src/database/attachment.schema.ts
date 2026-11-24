import { Schema } from 'mongoose';
import type { Media } from '@relay/shared';
export const attachmentSchema = new Schema<Media>(
  {
    key: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    fileName: { type: String, required: true },
    width: Number,
    height: Number,
  },
  { _id: false },
);
