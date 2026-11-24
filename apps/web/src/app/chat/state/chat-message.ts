import type { Message, ReceiptUpdate, SendMessage } from '@relay/shared/browser';
export interface ChatMessage extends Message {
  localStatus?: 'pending' | 'sent' | 'failed';
  input?: SendMessage;
}
const same = (a: ChatMessage, b: ChatMessage) =>
  a.messageId === b.messageId ||
  (a.senderId === b.senderId && a.clientMessageId === b.clientMessageId);
export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const items = existing.slice();
  for (const entry of incoming) {
    const index = items.findIndex((item) => same(item, entry));
    if (index < 0) {
      items.push(entry);
      continue;
    }
    const old = items[index];
    const deleted = old.deletedForEveryone || entry.deletedForEveryone;
    items[index] = {
      ...old,
      ...entry,
      deletedForEveryone: deleted,
      localStatus: entry.localStatus,
      input: entry.input,
      body: deleted ? undefined : entry.body,
      media: deleted ? undefined : entry.media,
      deliveredTo: [...new Set([...old.deliveredTo, ...entry.deliveredTo])],
      readBy: [...new Set([...old.readBy, ...entry.readBy])],
    };
  }
  return items.sort((a, b) => {
    if (a.sequence !== undefined && b.sequence !== undefined) return a.sequence - b.sequence;
    if (a.sequence !== undefined) return b.localStatus ? -1 : 1;
    if (b.sequence !== undefined) return a.localStatus ? 1 : -1;
    return a.createdAt.localeCompare(b.createdAt) || a.messageId.localeCompare(b.messageId);
  });
}
export function receiptFor(message: ChatMessage, update: ReceiptUpdate): ChatMessage {
  const deliveredTo = [...new Set([...message.deliveredTo, update.userId])];
  const readBy =
    update.kind === 'read' ? [...new Set([...message.readBy, update.userId])] : message.readBy;
  return { ...message, deliveredTo, readBy };
}
