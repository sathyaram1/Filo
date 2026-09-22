// Esplorazione: non asserisce niente, stampa e basta. Da cancellare.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

const archivio = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list());

test('impostazione non applicata: cosa resta nella chat riaperta', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));

  await fakeProvider(app, [
    { toolCalls: [{ id: 'e3', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'terminalMode', valore: 'quando serve' }) }] },
    { text: 'Ci provo.' },
  ], '__v567e3');

  await chiedi(page, 'attiva la modalità terminale quando serve');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ci provo.' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(4000);
  console.log('TITOLO LIVE:', await page.locator('.dash-activity-label').first().textContent());

  const chats = await archivio(app);
  console.log('ARCHIVIO:', JSON.stringify(chats.map((c) => c.messages.map((m) => ({ r: m.role, a: m.actions })))));
  if (chats.length) {
    const riaperta = await openTab(`filo://dashboard/dashboard.html?chat=${chats[0].id}`);
    await riaperta.waitForTimeout(2000);
    console.log('NOTE:', JSON.stringify(await riaperta.locator('.dash-bubble-note').allTextContents()));
  }
  await restore(app, '__v567e3');
});
