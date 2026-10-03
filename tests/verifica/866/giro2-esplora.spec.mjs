// Verifica #866 giro 2 — esplorazione: replaceState, pagina Sicurezza nei due temi.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const eventi = (ud) => { const f = join(ud, 'filo', 'eventi.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((r) => JSON.parse(r)) : []; };

test('una mappa che aggiorna l’indirizzo mentre la sposti non diventa venti pagine visitate', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  const url = testServer.html('<!doctype html><title>Mappa</title><p>mappa</p>');
  const page = await openTab(url);
  await expect.poll(() => eventi(userData).filter((e) => e.tipo === 'navigazione').length, { timeout: 20_000 }).toBe(1);
  for (let i = 0; i < 20; i++) {
    await page.evaluate((k) => history.replaceState(null, '', location.pathname + '?@41.9,12.' + k + ',15z'), i);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(5000);
  await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
  const n = eventi(userData).filter((e) => e.tipo === 'navigazione').length;
  console.log('eventi di navigazione dopo 20 replaceState:', n);
  expect(n).toBe(1);
});

test('pagina Sicurezza, sezione Pagine visitate, chiaro e scuro', async ({ app, openTab }) => {
  const page = await openTab('filo://security/security.html');
  await expect(page.locator('#sec-visite-oggi')).toHaveText('Cancella oggi');
  await page.locator('#sec-visite').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/v866-sicurezza-chiaro.png' });
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await page.waitForTimeout(1500);
  await page.locator('#sec-visite').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/v866-sicurezza-scuro.png' });
});
