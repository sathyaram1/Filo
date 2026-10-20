// Verifica #1443: la conversazione chiusa dal bottone della home resta chiusa anche in una scheda nuova.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, chatDi } from './aiuti.mjs';

test('r1 chiusa col bottone, la conversazione non si riapre nella scheda nuova', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fakeProvider(app, [
    { toolCalls: [{ id: 'f1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
    { text: 'Sei già qui, nella home.' },
    { text: 'Di niente.' },
  ]);
  await page.locator('#input').fill('portami alla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });
  await page.locator('.dash-action-btn', { hasText: 'Torna alla home' }).click();
  await expect(page.locator('.dash-action-btn', { hasText: 'Conversazione chiusa' })).toBeDisabled();
  await page.waitForTimeout(800);

  const nuova = await openTab('filo://newtab/');
  await expect(nuova.locator('#input')).toBeVisible();
  await nuova.waitForTimeout(800);
  await nuova.locator('#input').fill('grazie');
  await nuova.locator('#sendBtn').click();
  await expect(nuova.locator('.dash-bubble-filo', { hasText: 'Di niente.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => chatDi(app, 'grazie')).toHaveLength(1);
  const [prima] = await chatDi(app, 'portami alla home');
  expect(await chatDi(app, 'grazie'), 'la scheda nuova continua la conversazione chiusa').not.toContain(prima);
});

test('r1 chiusa col bottone, la conversazione non si riapre ricaricando la home', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fakeProvider(app, [
    { toolCalls: [{ id: 'f1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
    { text: 'Sei già qui, nella home.' },
    { text: 'Di niente.' },
  ]);
  await page.locator('#input').fill('portami alla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });
  await page.locator('.dash-action-btn', { hasText: 'Torna alla home' }).click();
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  await page.waitForTimeout(800);
  await page.locator('#input').fill('grazie');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Di niente.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => chatDi(app, 'grazie')).toHaveLength(1);
  const [prima] = await chatDi(app, 'portami alla home');
  expect(await chatDi(app, 'grazie'), 'la home ricaricata continua la conversazione chiusa').not.toContain(prima);
});
