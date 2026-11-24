import { mergeMessages, receiptFor, type ChatMessage } from './chat-message';
const durable: ChatMessage = {
  messageId: '66aa00000000000000000001',
  clientMessageId: 'same-client-id',
  senderId: 'alice',
  conversationId: 'chat',
  type: 'text',
  body: 'Hello',
  createdAt: '2026-11-24T04:00:00.000Z',
  readBy: [],
  deliveredTo: [],
  deletedForEveryone: false,
};
describe('message store', () => {
  it('merges optimistic, fan-out and backfill records without losing receipts', () => {
    const optimistic = {
      ...durable,
      messageId: durable.clientMessageId,
      localStatus: 'pending' as const,
    };
    const merged = mergeMessages([optimistic], [durable, durable]);
    expect(merged).toEqual([
      expect.objectContaining({ messageId: durable.messageId, localStatus: undefined }),
    ]);
    const read = receiptFor(merged[0], {
      messageId: durable.messageId,
      conversationId: 'chat',
      userId: 'bob',
      kind: 'read',
    });
    const replayed = mergeMessages([read], [durable])[0];
    expect(replayed.readBy).toEqual(['bob']);
    expect(replayed.deliveredTo).toEqual(['bob']);
    expect(
      mergeMessages(
        [replayed],
        [{ ...durable, senderId: 'carla', messageId: '66aa00000000000000000002' }],
      ),
    ).toHaveLength(2);
  });
  it('keeps a deletion tombstone when fan-out is replayed', () => {
    const hidden = { ...durable, deletedForEveryone: true, body: undefined };
    expect(mergeMessages([hidden], [durable])[0]).toMatchObject({
      deletedForEveryone: true,
      body: undefined,
    });
  });
});
