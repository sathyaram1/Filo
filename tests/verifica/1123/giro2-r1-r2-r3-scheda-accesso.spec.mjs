// Verifica #1123 giro 2: la scheda dell'accesso salvata nella sessione, «Collega» ripetuto, una pagina che non si
// carica scambiata per un rifiuto di Google.

import { test, expect } from '../../fixtures/electron.mjs';
import { googleFinto, schedeSu, indirizzoDellAccesso } from '../../helpers/googleFinto.mjs';

test('r1 la scheda dell\'accesso in attesa non finisce nella sessione da riaprire al prossimo avvio', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  await shell.evaluate(() => { window.__esito = window.filoShell.auth.signIn(); });
  expect(await indirizzoDellAccesso(app, pagina)).toBeTruthy();
  // Il salvataggio della sessione ha un ritardo di 400 ms.
  await new Promise((r) => setTimeout(r, 1500));
  const salvate = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getRaw('sn_open_tabs', null);
    return (s && s.tabs) || [];
  });
  expect(salvate.length, 'la sessione non è stata salvata').toBeGreaterThan(0);
  // Riaperta dopo un riavvio, quella pagina porta a un ritorno che non ascolta più: un vicolo cieco.
  expect(salvate.filter((u) => u.startsWith(pagina + '?'))).toEqual([]);
});

test('r2 chiedere due volte «Collega anche i prodotti Google» riporta davanti la stessa scheda', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  await shell.evaluate(() => window.filoShell.message({ type: 'auth_collega_google' }));
  expect(await indirizzoDellAccesso(app, pagina)).toBeTruthy();
  await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
  await shell.evaluate(() => window.filoShell.message({ type: 'auth_collega_google' }));
  await new Promise((r) => setTimeout(r, 2000));
  const schede = await schedeSu(app, pagina);
  expect(schede.length, 'si è aperta una seconda pagina d\'accesso a Google').toBe(1);
  expect(schede[0].attiva).toBe(true);
});

test('r3 una pagina d\'accesso che non si carica non viene raccontata come un rifiuto di Google', async ({ app, shell, testServer, avvisi }) => {
  await googleFinto(app, testServer);
  // L'indirizzo d'accesso su una porta dove nessuno risponde: la pagina non si carica.
  await app.evaluate(() => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]config\.js$/.test(x));
    M._cache[k].exports.authEndpoint = 'http://sito-pubblico.test:9/o/oauth2/v2/auth';
  });
  await shell.evaluate(() => { window.__esito = window.filoShell.auth.signIn(); });
  await expect.poll(() => app.evaluate(() => globalThis.__aperture.length), { timeout: 15_000 }).toBe(1);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif-msg').first()).toBeVisible({ timeout: 8_000 });
  const testi = await vista.locator('.shell-notif-msg').allInnerTexts();
  expect(testi.join(' | '), 'una pagina che non si carica non è Google che rifiuta Filo').not.toContain('Google non accetta');
});
