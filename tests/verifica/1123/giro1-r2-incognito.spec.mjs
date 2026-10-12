// #1123 giro 1, rilievo 2: l'accesso chiesto dalla finestra incognito apre la scheda in una finestra che resta dietro.
import { test, expect } from '../../fixtures/electron.mjs';
import { googleFinto, risposteFinte, schedeSu, indirizzoDellAccesso } from '../../helpers/googleFinto.mjs';

const EMAIL = 'chi.accede@prova.test';
async function paginaDi(app, prefisso) {
  const scade = Date.now() + 10_000;
  while (Date.now() < scade) {
    const p = app.windows().find((w) => { try { return w.url().startsWith(prefisso + '?'); } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nessuna pagina d\'accesso');
}

test('r2 accesso chiesto dalla finestra incognito: la finestra con la scheda dell\'accesso viene davanti', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  await risposteFinte(app, EMAIL);
  await shell.evaluate(() => window.filoShell.openIncognito());
  let inc = null;
  const scade = Date.now() + 15_000;
  while (!inc && Date.now() < scade) {
    inc = app.windows().find((w) => { try { return /shell\.html\?incognito=1/.test(w.url()); } catch (_) { return false; } });
    if (!inc) await new Promise((r) => setTimeout(r, 100));
  }
  await inc.waitForFunction(() => !!(window.filoShell && window.filoShell.auth));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    globalThis.__davanti = 0;
    for (const k of ['focus', 'show', 'restore', 'moveTop']) { const o = w[k].bind(w); w[k] = (...a) => { globalThis.__davanti++; return o(...a); }; }
  });
  await inc.evaluate(() => { window.__esito = window.filoShell.auth.signIn(); });
  expect(await indirizzoDellAccesso(app, pagina)).toBeTruthy();
  await new Promise((r) => setTimeout(r, 1000));
  expect(await app.evaluate(() => globalThis.__davanti), 'la finestra normale resta dietro quella incognito').toBeGreaterThan(0);
});
