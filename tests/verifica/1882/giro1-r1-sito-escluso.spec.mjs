// Verifica #1882 giro 1, rilievo 1: su un sito dove Filo è spento la pagina compila lo stesso i moduli pesanti.

import { test, expect } from '../../fixtures/electron.mjs';

const DALLE_PREFERENZE = { tab: { id: 5, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };

test('r1 su un sito escluso il pannello dell’Aiuto e gli altri moduli pesanti non si caricano', async ({ app, openTab, testServer }) => {
  await app.evaluate(async (_e, da) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { blocklist: ['127.0.0.1'] } }, da), DALLE_PREFERENZE);
  const page = await openTab(testServer.html('<!doctype html><body><p>sito escluso</p></body>'));
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);
  const moduli = await page.evaluate(() => (document.documentElement.dataset.filoModules || '').split(',').filter(Boolean));
  expect(moduli, 'il sito escluso non deve compilare il pannello dell’Aiuto').not.toContain('SN_SIDEBAR');
});
