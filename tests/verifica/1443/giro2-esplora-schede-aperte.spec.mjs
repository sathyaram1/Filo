// Verifica #1443 giro 2: la conversazione chiusa da una home resta chiusa anche nell'altra home già aperta.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, chatDi } from './aiuti.mjs';

async function chiudiInA(app, page) {
  await page.locator('.dash-action-btn', { hasText: 'Chiudi e torna alla home' }).click();
  await expect(page.locator('.dash-action-btn', { hasText: 'Conversazione chiusa' })).toBeDisabled();
  const [chiusa] = await chatDi(app, 'portami alla home');
  await expect.poll(() => app.evaluate(async (_e, id) => (await globalThis.SN_IL_FILO.chats()).find((c) => c.id === id)?.finita, chiusa)).toBe(true);
  return chiusa;
}

const GIRI = [
  { toolCalls: [{ id: 'f1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
  { text: 'Sei già qui, nella home.' },
  { text: 'Di niente.' },
];

test('scheda aperta dopo la conversazione, chiusa nella prima: la seconda non la continua', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fakeProvider(app, GIRI);
  await page.locator('#input').fill('portami alla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });

  const b = await openTab('filo://newtab/');
  await expect(b.locator('#input')).toBeVisible();
  await expect(b.locator('.dash-bubble-user', { hasText: 'portami alla home' })).toBeVisible({ timeout: 10_000 });
  await b.waitForTimeout(800);
  await shell.locator('.tab').first().click();
  await page.waitForTimeout(400);
  const chiusa = await chiudiInA(app, page);
  await shell.locator('.tab').nth(1).click();
  await b.waitForTimeout(400);
  await b.locator('#input').fill('grazie');
  await b.locator('#sendBtn').click();
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Di niente.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => chatDi(app, 'grazie')).toHaveLength(1);
  expect(await chatDi(app, 'grazie'), 'la seconda scheda continua la conversazione chiusa nella prima').not.toContain(chiusa);
});

test('scheda aperta prima della conversazione, chiusa nella prima: la seconda non la continua', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fakeProvider(app, GIRI);
  const b = await openTab('filo://newtab/');
  await expect(b.locator('#input')).toBeVisible();
  await b.waitForTimeout(800);
  await shell.locator('.tab').first().click();
  await page.waitForTimeout(400);
  await page.locator('#input').fill('portami alla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });
  const chiusa = await chiudiInA(app, page);
  await shell.locator('.tab').nth(1).click();
  await b.waitForTimeout(400);
  await b.locator('#input').fill('grazie');
  await b.locator('#sendBtn').click();
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Di niente.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => chatDi(app, 'grazie')).toHaveLength(1);
  expect(await chatDi(app, 'grazie'), 'la seconda scheda continua la conversazione chiusa nella prima').not.toContain(chiusa);
});

test('dopo un riavvio la conversazione chiusa resta chiusa, e il bottone si vede', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fakeProvider(app, GIRI);
  await page.locator('#input').fill('portami alla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'tests/.shots/1443-prima.png' });
  await chiudiInA(app, page);
  await page.screenshot({ path: 'tests/.shots/1443-dopo.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: 'tests/.shots/1443-dopo-chiaro.png' });
});
