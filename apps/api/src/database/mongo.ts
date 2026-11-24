import { Schema, Types } from 'mongoose';
export const oid = Schema.Types.ObjectId;
export const ref = (name: string) => ({ type: oid, ref: name, required: true as const });
export const objectId = (value: string) => new Types.ObjectId(value);
export const duplicate = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
