import type { Message } from '@relay/shared';
import type { MessageDoc } from './message.schema.js';
export function messageView(doc: MessageDoc): Message {
  return {
    messageId: String(doc._id),
    conversationId: String(doc.conversationId),
    senderId: String(doc.senderId),
    clientMessageId: doc.clientMessageId,
    sequence: doc.sequence,
    type: doc.type,
    body: doc.deletedForEveryone ? undefined : doc.body,
    media: doc.deletedForEveryone ? undefined : doc.media,
    replyTo: doc.replyTo?.toString(),
    createdAt: doc.createdAt.toISOString(),
    deliveredTo: doc.deliveredTo.map(String),
    readBy: doc.readBy.map(String),
    deletedForEveryone: doc.deletedForEveryone,
  };
}
