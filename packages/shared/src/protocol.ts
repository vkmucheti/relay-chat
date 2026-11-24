import type { AckError } from './index.js';

export const topics = {
  created: 'chat.messages.created',
  persisted: 'chat.messages.persisted',
  receipts: 'chat.receipts',
  notifications: 'chat.notifications',
  dlq: 'chat.dlq',
} as const;
export const events = {
  send: 'message:send',
  delivered: 'message:delivered',
  read: 'message:read',
  newMessage: 'message:new',
  deleted: 'message:deleted',
  receipt: 'receipt:update',
  typingStart: 'typing:start',
  typingStop: 'typing:stop',
  typing: 'typing:update',
  join: 'conversation:join',
  ping: 'presence:ping',
  presence: 'presence:update',
  conversation: 'conversation:updated',
  error: 'error',
} as const;
export const uploadTypes = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'application/zip',
] as const;
export const uploadLimit = 10 * 1024 * 1024;
export const rooms = {
  user: (id: string) => `user:${id}`,
  session: (id: string) => `session:${id}`,
  conversation: (id: string) => `conversation:${id}`,
};

export function isAckError(value: unknown): value is AckError {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
}
