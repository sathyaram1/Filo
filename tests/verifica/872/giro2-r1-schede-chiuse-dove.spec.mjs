// Verifica #872 giro 2, rilievo 1: i testi che dicono dove ritrovare le schede chiuse non rimandano più a una
// Cronologia (o «Tab archiviate») che non c'è: le schede chiuse stanno nel filo.

import { test, expect } from '../../fixtures/electron.mjs';

const VECCHIO = /Tab archiviate|in Cronologia|\(cronologia\)/;

test('r1 Preferenze: la pulizia delle schede e il riassunto delle schede chiuse non rimandano alla Cronologia', async ({ shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await openTab('filo://preferences/preferences.html');
  await expect(page.locator('main, body').first()).toContainText('schede chiuse', { timeout: 8_000 });
  const testo = await page.locator('body').innerText();
  expect(testo).not.toMatch(VECCHIO);
});

test('r1 la conferma del riordino delle schede e il suo esito non rimandano a «Tab archiviate»', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const testi = await app.evaluate(() => [String(globalThis.SN_ACTION_LEVELS.describe({ type: 'PULISCI_TAB' }) || '')]);
  expect(testi.join('\n')).toContain('schede');
  expect(testi.join('\n')).not.toMatch(VECCHIO);
});
