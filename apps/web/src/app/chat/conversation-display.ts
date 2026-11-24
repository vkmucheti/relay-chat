import type { Conversation, Message, User } from '@relay/shared/browser';
export function chatName(chat: Conversation, userId?: string) {
  return chat.type === 'group'
    ? (chat.name ?? 'Group')
    : (partner(chat, userId)?.displayName ?? 'Direct chat');
}
export function partner(chat: Conversation, userId?: string): User | undefined {
  return chat.members.find(({ user }) => user.id !== userId)?.user;
}
export function preview(msg: Message | undefined) {
  if (!msg) return 'Start the conversation';
  if (msg.deletedForEveryone) return 'Message deleted';
  switch (msg.type) {
    case 'image':
      return 'Photo';
    case 'file':
      return msg.media?.fileName ?? 'Attachment';
    case 'text':
      return msg.body ?? '';
  }
}
