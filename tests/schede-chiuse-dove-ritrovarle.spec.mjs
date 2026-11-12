// #872.4 — la Cronologia e «Tab archiviate» non ci sono più: le schede chiuse stanno nel filo della home, e i testi che
// dicono dove ritrovarle (Preferenze, la conferma del riordino, quella della chat) mandano lì. La regola su ogni testo
// del codice la tiene tests/unit/schedeChiuseNelFilo.test.mjs; qui si guarda quello che l'utente legge davvero.

import { test, expect } from './fixtures/electron.mjs';

test('Preferenze e le conferme di «Riordina le schede» mandano a cercare le schede chiuse nel filo della home', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const pref = await openTab('filo://preferences/preferences.html');
  const sezione = pref.locator('section', { has: pref.locator('h2', { hasText: 'Gestione automatica delle schede' }) });
  await expect(sezione.locator('p.sn-muted').first()).toContainText('le schede chiuse restano nel filo della home');
  await expect(pref.locator('label', { has: pref.locator('#riassuntoSchede') })).toContainText('per ritrovarle nel filo della home anche per significato');
  await expect(sezione).not.toContainText(/Tab archiviate|Cronologia/);

  // /pulisci a Conservativo chiede conferma col popup di Filo: il testo dice dove finiscono le schede.
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' } }));
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeVisible({ timeout: 8_000 });
  await home.evaluate(() => {
    window.__conferma = null;
    window.SN_CONFIRM_UI.confirm = (o) => { window.__conferma = o.text; return Promise.resolve(false); };
    const input = document.getElementById('input');
    input.value = '/pulisci';
    document.getElementById('inputForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  });
  await expect.poll(() => home.evaluate(() => window.__conferma), { timeout: 8_000 }).toContain('nel filo della home');
  expect(await home.evaluate(() => window.__conferma)).not.toMatch(/Tab archiviate|[Cc]ronologia/);

  // Lo stesso riordino chiesto in chat: il popup mostra la descrizione del registro.
  const chat = await app.evaluate(() => globalThis.SN_ACTION_LEVELS.describe({ type: 'PULISCI_TAB' }));
  expect(chat).toContain('nel filo della home');
  expect(chat).not.toMatch(/Tab archiviate|[Cc]ronologia/);
});
