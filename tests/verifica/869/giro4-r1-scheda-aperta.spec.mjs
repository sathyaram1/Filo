// Verifica #869 giro 4, rilievo 1: una home già aperta, tornandoci, continua lo scambio fatto in un'altra scheda invece
// di cominciare una conversazione separata.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';

test('r1 scrivo in una scheda, torno alla home già aperta in un’altra e rispondo: è la stessa conversazione', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const casa = await home(app);
  const altra = await openTab('filo://newtab/');
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const ids = ((snap && (snap.tabs || snap)) || []).map((t) => t.id);
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), ids[0]);
  await modelloFinto(app, [{ text: 'Le orche cacciano in branco.' }, { text: 'Sì, anche le balene.' }]);
  await chiedi(casa, 'come cacciano le orche?');
  await expect(casa.locator('.dash-bubble-filo', { hasText: 'Le orche cacciano in branco.' })).toBeVisible();
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), ids[1]);
  // Nel contenitore la scheda di dietro resta «visibile» per le anteprime: il ritorno lo si dice com'è su una macchina vera.
  await altra.waitForTimeout(500);
  await altra.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(altra.locator('.dash-bubble-filo', { hasText: 'Le orche cacciano in branco.' })).toBeVisible({ timeout: 10_000 });
  await chiedi(altra, 'e le balene?');
  await expect(altra.locator('.dash-bubble-filo', { hasText: 'Sì, anche le balene.' })).toBeVisible();
  const chats = await app.evaluate(async () => (await globalThis.SN_IL_FILO.chats()).filter((c) => !c.app).map((c) => c.messages.map((m) => m.text)));
  expect(chats).toEqual([['come cacciano le orche?', 'Le orche cacciano in branco.', 'e le balene?', 'Sì, anche le balene.']]);
});
