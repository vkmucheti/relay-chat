import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { argon2id, hash } from 'argon2';
import { setTimeout as delay } from 'node:timers/promises';
import { SeedModule } from './seed/seed.module.js';
import { loadEnv } from './config/environment.js';
import { ConversationsService } from './conversations/conversations.service.js';
import { MessagesService } from './messages/messages.service.js';
import { UsersService } from './users/users.service.js';

const people = [
  { username: 'alice', displayName: 'Alice Chen' },
  { username: 'bob', displayName: 'Bob Rivera' },
  { username: 'carla', displayName: 'Carla Silva' },
  { username: 'dev', displayName: 'Dev Patel' },
  { username: 'eva', displayName: 'Eva Okafor' },
];
async function main() {
  const env = loadEnv(process.env);
  if (env.APP_ENV !== 'development' || !env.DEMO_PASSWORD)
    throw new Error('Seed requires development mode and DEMO_PASSWORD.');
  const app = await NestFactory.createApplicationContext(SeedModule.register(env), {
    logger: false,
    abortOnError: false,
  });
  try {
    const users = app.get(UsersService);
    const conversations = app.get(ConversationsService);
    const messages = app.get(MessagesService);
    const passwordHash = await hash(env.DEMO_PASSWORD, {
      type: argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const ids: string[] = [];
    for (const person of people) {
      ids.push(
        await users.ensureUser({
          ...person,
          email: person.username + '@relay.example',
          passwordHash,
          about: 'Here to keep in touch.',
        }),
      );
    }
    const [alice, bob, carla, dev, eva] = ids;
    const direct = await conversations.direct(alice, bob);
    const groupId =
      (await conversations.findGroupId(alice, 'Weekend plans')) ??
      (await conversations.group(alice, { name: 'Weekend plans', userIds: [bob, carla, dev, eva] }))
        .id;
    const samples = [
      { conversationId: direct.id, sender: alice, body: 'Hey Bob! Coffee this week?' },
      { conversationId: direct.id, sender: bob, body: 'Yes! Thursday afternoon works for me.' },
      { conversationId: groupId, sender: carla, body: 'Anyone up for a walk on Saturday?' },
      { conversationId: groupId, sender: dev, body: 'I’m in. Let’s meet by the park entrance.' },
      { conversationId: groupId, sender: eva, body: 'See you at ten!' },
    ];
    for (const [index, sample] of samples.entries()) {
      const clientMessageId = `7ac1f498-4409-40b4-9a90-${String(index + 1).padStart(12, '0')}`;
      if (await messages.hasMessage(sample.sender, clientMessageId)) continue;
      await messages.send(sample.sender, {
        conversationId: sample.conversationId,
        clientMessageId,
        type: 'text',
        body: sample.body,
      });
      const deadline = Date.now() + 20000;
      while (!(await messages.hasMessage(sample.sender, clientMessageId))) {
        if (Date.now() >= deadline)
          throw new Error('Timed out waiting for the worker to persist seed messages.');
        await delay(200);
      }
    }
    console.log('Seeded five demo users, a direct conversation and a group.');
  } finally {
    await app.close();
  }
}
void main().catch((error: unknown) => {
  console.error('Seed failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
});
