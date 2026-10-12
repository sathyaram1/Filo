// #1123 giro 6: con l'accesso in attesa nella sua scheda, il clic sull'icona del profilo non fa niente: non
// riporta davanti la pagina di Google, che è il modo naturale di tornarci.
import { test, expect } from '../../fixtures/electron.mjs';
import { googleFinto, schedeSu, indirizzoDellAccesso } from '../../helpers/googleFinto.mjs';

async function popupMenu(app) {
  const scade = Date.now() + 8_000;
  while (Date.now() < scade) {
    const popup = app.windows().find((w) => { try { return w.url().startsWith('data:text/html'); } catch (_) { return false; } });
    if (popup) {
      try { await popup.locator('button.item').first().waitFor({ timeout: 1000 }); return popup; } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test('r2 con l\'accesso in attesa, il clic sull\'icona del profilo riporta davanti la pagina di Google', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  await shell.evaluate(() => document.getElementById('nav-account').click());
  const popup = await popupMenu(app);
  expect(popup).toBeTruthy();
  await popup.locator('button.item', { hasText: 'Accedi con Google' }).click();
  expect(await indirizzoDellAccesso(app, pagina)).toBeTruthy();
  const [scheda] = await schedeSu(app, pagina);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
  await expect.poll(() => schedeSu(app, pagina).then((s) => s[0] && s[0].attiva)).toBe(false);
  // L'utente torna all'accesso dall'icona del profilo, che dice «Accesso in corso…».
  expect(await shell.evaluate(() => document.getElementById('nav-account').dataset.tip)).toMatch(/Accesso in corso/);
  await shell.evaluate(() => document.getElementById('nav-account').click());
  await expect.poll(() => schedeSu(app, pagina).then((s) => s.map((x) => `${x.id}:${x.attiva}`).join()), { timeout: 5_000 })
    .toBe(`${scheda.id}:true`);
});
