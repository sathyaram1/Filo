// Esplorazione: non asserisce niente, stampa e basta. Da cancellare.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

const archivio = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list());

test('cosa racconta la chat riaperta', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'e1', name: 'EVENTO_CALENDARIO', arguments: JSON.stringify({ titolo: 'Cena con Anna', data: '2026-10-02', ora: '20:30' }) }] },
    { text: 'Te lo segno.' },
  ], '__v567e1');

  await chiedi(page, 'segnami la cena con Anna venerdì alle 20:30');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Te lo segno.' })).toBeVisible({ timeout: 15_000 });
  await page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' }).click();
  await page.waitForTimeout(2000);
  console.log('TITOLO LIVE:', await page.locator('.dash-activity-label').first().textContent());

  await page.waitForTimeout(3000);
  const chats = await archivio(app);
  console.log('ARCHIVIO:', JSON.stringify(chats.map((c) => ({ id: c.id, msgs: c.messages.map((m) => ({ role: m.role, text: (m.text || '').slice(0, 40), actions: m.actions })) })), null, 1));

  if (chats.length) {
    const riaperta = await openTab(`filo://dashboard/dashboard.html?chat=${chats[0].id}`);
    await riaperta.waitForTimeout(2000);
    console.log('NOTE RIAPERTA:', JSON.stringify(await riaperta.locator('.dash-bubble-note').allTextContents()));
    console.log('TUTTO IL THREAD:', (await riaperta.locator('.dash-thread').textContent() || '').slice(0, 600));
  }
  await restore(app, '__v567e1');
});
