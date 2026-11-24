import { randomUUID } from 'node:crypto';
import {
  events,
  type Ack,
  isAckError,
  type AuthSession,
  type Conversation,
  type Message,
  type Page,
  type PresenceUpdate,
  type ReceiptUpdate,
  type SendAccepted,
  type TypingUpdate,
} from '@relay/shared';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';

const origins = [
  process.env.E2E_API_URL ?? 'http://localhost:3000',
  process.env.E2E_SECOND_API_URL ?? 'http://localhost:3001',
];
const path = '/api/v1';
const password = 'Integration-Test-Password!';
const sockets: Socket[] = [];
const bearer = (session: AuthSession) => 'Bearer ' + session.accessToken;
function connect(origin: string, token: string) {
  const socket = io(origin, {
    transports: ['websocket'],
    auth: { token },
    autoConnect: false,
    forceNew: true,
    reconnection: false,
  });
  sockets.push(socket);
  return new Promise<Socket>((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
    socket.connect();
  });
}
function event<T>(socket: Socket, name: string, predicate: (value: T) => boolean) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(name, listener);
      reject(new Error('Timed out waiting for ' + name));
    }, 12000);
    const listener = (value: T) => {
      if (predicate(value)) {
        clearTimeout(timeout);
        socket.off(name, listener);
        resolve(value);
      }
    };
    socket.on(name, listener);
  });
}
async function ack<T>(socket: Socket, name: string, value: unknown) {
  const result = (await socket.timeout(15000).emitWithAck(name, value)) as Ack<T>;
  if (isAckError(result)) throw new Error(result.error.message);
  return result;
}
async function register(origin: string, label: string) {
  const username = label + '_' + randomUUID().slice(0, 10).replaceAll('-', '');
  const res = await request(origin)
    .post(path + '/auth/register')
    .send({ username, displayName: label, email: username + '@relay.example', password })
    .expect(201);
  expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
  return {
    username,
    session: res.body as AuthSession,
    cookie: String(res.headers['set-cookie'][0]).split(';')[0],
  };
}
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.disconnect();
});

it('rotates the refresh cookie and revokes the session when an older token is reused', async () => {
  const [origin] = origins;
  const user = await register(origin, 'rotation');
  const refreshed = await request(origin)
    .post(path + '/auth/refresh')
    .set('Cookie', user.cookie)
    .send({})
    .expect(200);
  expect(refreshed.headers['set-cookie'][0]).not.toContain(user.cookie);
  const current = refreshed.body as AuthSession;
  const socket = await connect(origins[1], current.accessToken);
  await ack(socket, events.ping, {});
  const disconnected = event<string>(
    socket,
    'disconnect',
    (reason) => reason === 'io server disconnect',
  );
  await request(origin)
    .post(path + '/auth/refresh')
    .set('Cookie', user.cookie)
    .send({})
    .expect(401);
  await disconnected;
  await request(origin)
    .get(path + '/users/me')
    .set('Authorization', bearer(refreshed.body as AuthSession))
    .expect(401);
});
it('persists and fans out between two gateways, applies receipts and deduplicates a retried send', async () => {
  const [a, b] = origins;
  await Promise.all(origins.map((origin) => request(origin).get('/health/ready').expect(200)));
  const [first, second, outsider] = await Promise.all([
    register(a, 'alice'),
    register(b, 'bob'),
    register(a, 'outsider'),
  ]);
  const login = await request(a)
    .post(path + '/auth/login')
    .send({ login: first.username, password })
    .expect(200);
  const alice = login.body as AuthSession;
  const bob = second.session;
  const created = await request(a)
    .post(path + '/conversations/direct')
    .set('Authorization', bearer(alice))
    .send({ userId: bob.user.id })
    .expect(201);
  const { id: conversationId } = created.body as Conversation;
  const same = await request(b)
    .post(path + '/conversations/direct')
    .set('Authorization', bearer(bob))
    .send({ userId: alice.user.id })
    .expect(201);
  expect((same.body as Conversation).id).toBe(conversationId);
  await request(a)
    .get(path + `/conversations/${conversationId}/messages`)
    .set('Authorization', bearer(outsider.session))
    .expect(404);
  const sender = await connect(a, alice.accessToken);
  await ack(sender, events.join, { conversationId });
  const bobOnline = event<PresenceUpdate>(
    sender,
    events.presence,
    (value) => value.userId === bob.user.id && value.online,
  );
  const receiver = await connect(b, bob.accessToken);
  await ack(receiver, events.join, { conversationId });
  await bobOnline;
  const typing = event<TypingUpdate>(
    receiver,
    events.typing,
    (value) => value.userId === alice.user.id && value.typing,
  );
  await ack(sender, events.typingStart, { conversationId });
  await typing;
  const body = 'Across gateways ' + randomUUID();
  const clientMessageId = randomUUID();
  const incoming = event<Message>(
    receiver,
    events.newMessage,
    (value) => value.clientMessageId === clientMessageId,
  );
  const send = { conversationId, clientMessageId, type: 'text', body };
  const accepted = await ack<SendAccepted>(sender, events.send, send);
  expect(accepted.status).toBe('sent');
  expect((await incoming).messageId).toBe(accepted.messageId);
  const history = async () => {
    const res = await request(b)
      .get(path + `/conversations/${conversationId}/messages`)
      .set('Authorization', bearer(bob))
      .expect(200);
    return (res.body as Page<Message>).items;
  };
  expect((await history()).find((message) => message.messageId === accepted.messageId)?.body).toBe(
    body,
  );
  const receipt = { conversationId, messageId: accepted.messageId };
  for (const kind of ['delivered', 'read'] as const) {
    const succeeded = event<ReceiptUpdate>(
      sender,
      events.receipt,
      (update) => update.messageId === receipt.messageId && update.kind === kind,
    );
    await ack(receiver, events[kind], receipt);
    expect((await succeeded).userId).toBe(bob.user.id);
  }
  const duplicateFanout = event<Message>(
    receiver,
    events.newMessage,
    (value) => value.clientMessageId === clientMessageId,
  );
  expect(await ack<SendAccepted>(sender, events.send, send)).toEqual(accepted);
  await duplicateFanout;
  expect(
    (await history()).filter((message) => message.clientMessageId === clientMessageId),
  ).toEqual([expect.objectContaining({ readBy: [bob.user.id], deliveredTo: [bob.user.id] })]);
  const bobOther = await connect(a, bob.accessToken);
  await ack(bobOther, events.join, { conversationId });
  receiver.disconnect();
  await ack(bobOther, events.ping, {});
  const onlineUser = await request(b)
    .get(path + '/users/me')
    .set('Authorization', bearer(bob))
    .expect(200);
  expect((onlineUser.body as AuthSession['user']).lastSeenAt).toBeUndefined();
  const gone = event<PresenceUpdate>(
    sender,
    events.presence,
    (value) => value.userId === bob.user.id && !value.online,
  );
  bobOther.disconnect();
  expect((await gone).lastSeenAt).toBeDefined();

  const nextId = randomUUID();
  const persisted = event<Message>(
    sender,
    events.newMessage,
    (value) => value.clientMessageId === nextId,
  );
  const later = await ack<SendAccepted>(sender, events.send, {
    ...send,
    clientMessageId: nextId,
    body: 'Missed while offline',
  });
  await persisted;
  const backfill = await request(b)
    .get(path + `/conversations/${conversationId}/messages`)
    .query({ after: accepted.messageId })
    .set('Authorization', bearer(bob))
    .expect(200);
  expect((backfill.body as Page<Message>).items.map((item) => item.messageId)).toEqual([
    later.messageId,
  ]);
  const recent = await request(b)
    .get(path + '/conversations')
    .set('Authorization', bearer(bob))
    .expect(200);
  expect(
    (recent.body as Page<Conversation>).items.find((item) => item.id === conversationId)
      ?.unreadCount,
  ).toBe(1);
});

it('removes group access across gateways and restricts deletion to the sender', async () => {
  const [a, b] = origins;
  const [owner, member] = await Promise.all([register(a, 'owner'), register(b, 'member')]);
  const response = await request(a)
    .post(path + '/conversations/group')
    .set('Authorization', bearer(owner.session))
    .send({ name: 'Group', userIds: [member.session.user.id] })
    .expect(201);
  const id = (response.body as Conversation).id;
  const base = path + '/conversations/' + id;
  await request(b)
    .patch(base)
    .set('Authorization', bearer(member.session))
    .send({ name: 'Forbidden' })
    .expect(403);
  await request(a)
    .patch(base)
    .set('Authorization', bearer(owner.session))
    .send({ name: 'New group name' })
    .expect(200);
  const sender = await connect(a, owner.session.accessToken);
  const receiver = await connect(b, member.session.accessToken);
  await Promise.all([
    ack(sender, events.join, { conversationId: id }),
    ack(receiver, events.join, { conversationId: id }),
  ]);
  const clientMessageId = randomUUID();
  const incoming = event<Message>(
    receiver,
    events.newMessage,
    (message) => message.clientMessageId === clientMessageId,
  );
  const { messageId } = await ack<SendAccepted>(sender, events.send, {
    conversationId: id,
    clientMessageId,
    type: 'text',
    body: 'Group message',
  });
  await incoming;
  const removePath = path + '/messages/' + messageId;
  await request(b)
    .delete(removePath)
    .query({ scope: 'everyone' })
    .set('Authorization', bearer(member.session))
    .expect(403);
  await request(a)
    .delete(removePath)
    .query({ scope: 'everyone' })
    .set('Authorization', bearer(owner.session))
    .expect(204);
  const history = await request(b)
    .get(base + '/messages')
    .set('Authorization', bearer(member.session))
    .expect(200);
  expect((history.body as Page<Message>).items[0]).toMatchObject({
    messageId,
    deletedForEveryone: true,
  });
  expect((history.body as Page<Message>).items[0].body).toBeUndefined();
  await request(a)
    .delete(base + '/members')
    .set('Authorization', bearer(owner.session))
    .send({ userIds: [member.session.user.id] })
    .expect(200);
  await request(b)
    .get(base + '/messages')
    .set('Authorization', bearer(member.session))
    .expect(404);
  await expect(
    ack(receiver, events.send, {
      conversationId: id,
      clientMessageId: randomUUID(),
      type: 'text',
      body: 'No longer a member',
    }),
  ).rejects.toThrow('Conversation not found');
});
