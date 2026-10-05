// Verifica #675, giro 1: Gestione → Automazioni, scelte salvate a poca distanza.

import { test, expect } from '../../fixtures/electron.mjs';
import { apri, cambia } from './banco.mjs';

test('una richiesta che resta appesa non trattiene la scelta successiva su un altro campo', async ({ openTab }) => {
  const page = await apri(openTab);
  // Il numero resta appeso (rete che non risponde), l'owner esclude l'account A.
  await page.evaluate(() => { window.__delaySet = [20000, 0]; });
  await page.locator('#mgMaxSessions').fill('7');
  await page.locator('#mgMaxSessionsSave').click();
  await cambia(page, 'mgAccountA', false);
  // L'esclusione di A deve arrivare al server senza aspettare il numero.
  await expect.poll(() => page.evaluate(() => window.__doc.accountAOff === true), { timeout: 3000 }).toBe(true);
  await expect(page.locator('#mgAccountsMsg')).toHaveText('Salvato.');
});
