import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
const password = 'Browser-Test-Password!';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/gAAAABJRU5ErkJggg==',
  'base64',
);
const waitForChat = (page: Page) =>
  expect(page.getByRole('heading', { name: 'Chats', exact: true })).toBeVisible();
async function signup(page: Page, username: string, name: string) {
  await page.goto('/register');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Email', { exact: true }).fill(username + '@relay.example');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await waitForChat(page);
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Username or email').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await waitForChat(page);
}
test('two browser sessions exchange text and a photo with presence, typing and receipts', async ({
  browser,
  baseURL,
}, testInfo) => {
  const a = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: testInfo.project.use.ignoreHTTPSErrors,
  });
  const b = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: testInfo.project.use.ignoreHTTPSErrors,
  });
  const alice = await a.newPage();
  const bob = await b.newPage();
  const suffix = randomUUID().slice(0, 8);
  try {
    await Promise.all([
      signup(alice, 'alice_' + suffix, 'Alice Browser'),
      signup(bob, 'bob_' + suffix, 'Bob Browser'),
    ]);
    await alice.getByRole('button', { name: 'New chat', exact: true }).click();
    await alice.getByRole('textbox', { name: 'Find people' }).fill('bob_' + suffix);
    await alice
      .getByRole('dialog', { name: 'Start a chat' })
      .getByRole('button', { name: /Bob Browser/ })
      .click();
    await expect(alice.locator('.conversation-title')).toContainText('Online');
    await bob.getByRole('link', { name: /Alice Browser/ }).click();
    await expect(bob.locator('.conversation-title')).toContainText('Online');
    const text = 'Hello over Kafka ' + suffix;
    await alice.getByRole('textbox', { name: 'Write a message' }).fill(text);
    await expect(bob.locator('.conversation-title')).toContainText('Typing…');
    await alice.getByRole('textbox', { name: 'Write a message' }).press('Enter');
    await expect(
      bob.getByRole('region', { name: 'Conversation' }).getByText(text, { exact: true }),
    ).toBeVisible();
    await expect(alice.locator('.receipt-tick[aria-label="Read"]')).toBeVisible({ timeout: 15000 });
    await bob
      .locator('input[type=file]')
      .setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
    const photo = alice.getByRole('button', { name: 'Open photo' });
    await expect(photo).toBeEnabled({ timeout: 20000 });
    await expect(photo.locator('img')).toBeVisible();
    await expect
      .poll(() => photo.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(1);
    await photo.click();
    await expect(alice.getByRole('dialog', { name: 'Photo attachment' })).toBeVisible();
    await alice.getByRole('button', { name: 'Close photo' }).click();
    await expect(bob.locator('.receipt-tick[aria-label="Read"]')).toBeVisible({ timeout: 15000 });
    await alice.reload();
    await expect(
      alice.getByRole('region', { name: 'Conversation' }).getByText(text, { exact: true }),
    ).toBeVisible();
    await expect(photo.locator('img')).toBeVisible();
    await bob.close();
    await expect(alice.locator('.conversation-title')).toContainText('Last seen');
    if (process.env.E2E_SCREENSHOT) await alice.screenshot({ path: process.env.E2E_SCREENSHOT });
    await alice.setViewportSize({ width: 390, height: 844 });
    await expect(alice.getByRole('navigation', { name: 'Chat list' })).toBeHidden();
    await alice.getByRole('link', { name: 'Back to chats' }).click();
    await expect(alice.getByRole('link', { name: /Bob Browser/ })).toBeVisible();
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});

test('protected routes preserve the session across profile and group navigation', async ({
  page,
  request,
}) => {
  const suffix = randomUUID().slice(0, 8);
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login$/);
  const peer = 'peer_' + suffix;
  const registered = await request.post('/api/v1/auth/register', {
    data: {
      username: peer,
      email: peer + '@relay.example',
      displayName: 'Architecture Peer',
      password,
    },
  });
  expect(registered.status()).toBe(201);
  await signup(page, 'owner_' + suffix, 'Architecture Owner');

  await page.getByRole('link', { name: /My profile/ }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible();
  await page.getByLabel('Display name').fill('Updated Owner');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  await page.getByRole('link', { name: /Back to chats/ }).click();

  await page.getByRole('button', { name: 'Create group' }).click();
  const create = page.getByRole('dialog', { name: 'Create a group' });
  await create.getByLabel('Group name').fill('Architecture Group');
  await create.getByRole('textbox', { name: 'Find people' }).fill(peer);
  await create.getByRole('button', { name: /Architecture Peer/ }).click();
  await create.getByRole('button', { name: 'Create group' }).click();

  await page.getByRole('button', { name: 'Group details' }).click();
  const details = page.getByRole('dialog', { name: 'Group details' });
  await details.getByLabel('Group name').fill('Renamed Group');
  await details.getByRole('button', { name: 'Save', exact: true }).click();
  await details.getByRole('button', { name: 'Close group details' }).click();
  await expect(page.getByRole('heading', { name: 'Renamed Group' })).toBeVisible();

  const chatUrl = page.url();
  await page.getByRole('link', { name: /My profile/ }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(chatUrl);
  await expect(page).toHaveURL(/\/login$/);
});
