import { z } from 'zod';

import { uploadTypes, uploadLimit } from './protocol.js';
export * from './protocol.js';
export const idSchema = z.string().regex(/^[a-f0-9]{24}$/);
export const id = idSchema;
export const mediaKeySchema = z.string().regex(/^[a-f0-9]{24}[/][a-f0-9]{24}[/][a-f0-9-]{36}$/);
export const mediaSchema = z.strictObject({
  key: mediaKeySchema,
  mimeType: z.enum(uploadTypes),
  size: z.int().positive().max(uploadLimit),
  fileName: z.string().min(1).max(180),
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
});
export const conversationSchema = z.strictObject({ conversationId: id });
export const receiptInput = conversationSchema.extend({ messageId: id });
const sendBase = conversationSchema.extend({ clientMessageId: z.uuid(), replyTo: id.optional() });
export const sendSchema = z.discriminatedUnion('type', [
  sendBase.extend({ type: z.literal('text'), body: z.string().trim().min(1).max(4000) }),
  sendBase.extend({ type: z.enum(['image', 'file']), mediaKey: mediaKeySchema }),
]);
export const createdSchema = z.strictObject({
  messageId: id,
  conversationId: id,
  senderId: id,
  clientMessageId: z.uuid(),
  type: z.enum(['text', 'image', 'file']),
  body: z.string().max(4000).optional(),
  media: mediaSchema.optional(),
  replyTo: id.optional(),
  createdAt: z.iso.datetime(),
  correlationId: z.uuid(),
});
export const messageSchema = createdSchema.omit({ correlationId: true }).extend({
  sequence: z.int().positive().optional(),
  deliveredTo: z.array(id),
  readBy: z.array(id),
  deletedForEveryone: z.boolean(),
});
export const persistedSchema = z.strictObject({
  message: messageSchema,
  recipients: z.array(id),
  correlationId: z.uuid(),
});
export const receiptEventSchema = receiptInput.extend({
  userId: id,
  kind: z.enum(['delivered', 'read']),
  correlationId: z.uuid(),
});
export const notificationSchema = receiptInput.extend({ userId: id, correlationId: z.uuid() });
export const dlqSchema = z.strictObject({
  topic: z.string(),
  partition: z.int(),
  offset: z.string(),
  key: z.string().optional(),
  correlationId: z.uuid().optional(),
  error: z.string(),
  attempts: z.int().positive(),
});
export type SendMessage = z.infer<typeof sendSchema>;
export type MessageCreated = z.infer<typeof createdSchema>;
export type MessagePersisted = z.infer<typeof persistedSchema>;
export type ReceiptInput = z.infer<typeof receiptInput>;
export type ReceiptEvent = z.infer<typeof receiptEventSchema>;
export type NotificationEvent = z.infer<typeof notificationSchema>;
export type DeadLetterEvent = z.infer<typeof dlqSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Media = z.infer<typeof mediaSchema>;
export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarKey?: string;
  about?: string;
  lastSeenAt?: string;
}
export interface Me extends User {
  email: string;
}
export interface AuthSession {
  accessToken: string;
  user: Me;
}
export interface Contact {
  id: string;
  user: User;
  alias?: string;
}
export interface Member {
  user: User;
  role: 'admin' | 'member';
  joinedAt: string;
}
export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  name?: string;
  avatarKey?: string;
  createdBy: string;
  members: Member[];
  unreadCount: number;
  lastReadMessageId?: string;
  lastMessage?: Message;
  updatedAt: string;
}
export interface Page<T> {
  items: T[];
  nextCursor?: string;
}
export interface SendAccepted {
  clientMessageId: string;
  messageId: string;
  status: 'sent';
}
export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
}
export type AckError = { ok: false; error: ApiError };
export type Ack<T = true> = T | AckError;
export interface PresenceUpdate {
  userId: string;
  online: boolean;
  lastSeenAt?: string;
}
export interface TypingUpdate {
  conversationId: string;
  userId: string;
  typing: boolean;
}
export interface ReceiptUpdate {
  conversationId: string;
  messageId: string;
  userId: string;
  kind: 'delivered' | 'read';
}
export interface DeletedMessage {
  conversationId: string;
  messageId: string;
  forEveryone: boolean;
}
export interface ConversationUpdate {
  conversationId: string;
  removed?: boolean;
}
export interface UploadRequest {
  conversationId: string;
  mimeType: string;
  size: number;
  fileName: string;
}
export interface UploadTicket {
  key: string;
  url: string;
  headers: Record<string, string>;
}
