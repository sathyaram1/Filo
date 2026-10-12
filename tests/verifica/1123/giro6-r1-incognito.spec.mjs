// #1123 giro 6: «Collega anche i prodotti Google» chiesto da una finestra incognito porta l'indirizzo della pagina
// incognito nella finestra normale, dove Google rimanda dopo l'accesso (e la cronologia lo tiene).
import { test, expect } from '../../fixtures/electron.mjs';
import { googleFinto, indirizzoDellAccesso } from '../../helpers/googleFinto.mjs';

const SEGRETO = 'https://www.youtube.com/watch?v=visto-in-incognito';

test('r1 «Collega anche i prodotti Google» da incognito non porta la pagina incognito nella finestra normale', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  await shell.evaluate(() => window.filoShell.openIncognito());
  let inc = null;
  const scade = Date.now() + 15_000;
  while (!inc && Date.now() < scade) {
    inc = app.windows().find((w) => { try { return /shell\.html\?incognito=1/.test(w.url()); } catch (_) { return false; } });
    if (!inc) await new Promise((r) => setTimeout(r, 100));
  }
  await inc.waitForFunction(() => !!(window.filoShell && window.filoShell.message));
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && x._filoIncognito);
    w._filoTabs.openTab(u, { activate: true });
  }, SEGRETO);
  const r = await inc.evaluate(() => window.filoShell.message({ type: 'auth_collega_google' }));
  expect(r && r.ok).toBe(true);
  const url = await indirizzoDellAccesso(app, pagina);
  expect(url).toBeTruthy();
  const normale = await app.evaluate(({ BrowserWindow }, p) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.tabs.some((t) => String(t.url || '').startsWith(p));
  }, pagina);
  expect(normale, 'la pagina d\'accesso sta nella finestra normale').toBe(true);
  // Dopo l'accesso Google porta la scheda della finestra normale su `continue`.
  expect(new URL(url).searchParams.get('continue'), 'l\'indirizzo visto in incognito arriva nella finestra normale').not.toBe(SEGRETO);
});
