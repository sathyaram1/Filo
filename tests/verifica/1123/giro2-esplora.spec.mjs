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
  throw new Error('nessuna scheda');
}

test('esplora: cronologia e scheda attiva dopo l\'accesso in scheda', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  await risposteFinte(app, EMAIL);
  const partenza = testServer.html('<title>Partenza</title><p>qui</p>', { pubblico: true });
  await shell.evaluate((u) => window.filoShell.tabs.open(u), partenza);
  await new Promise((r) => setTimeout(r, 1500));
  const snap0 = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const attivaPrima = snap0.activeId;
  await shell.evaluate(() => { window.__esito = window.filoShell.auth.signIn(); });
  await indirizzoDellAccesso(app, pagina);
  await (await paginaDi(app, pagina)).locator('#continua').click();
  const r = await shell.evaluate(() => window.__esito);
  expect(r.ok).toBe(true);
  await expect.poll(() => schedeSu(app, pagina).then((s) => s.length)).toBe(0);
  await new Promise((r2) => setTimeout(r2, 2000));
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const storia = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const h = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.GET_HISTORY }, { url: 'filo://history/history.html', tab: null });
    return JSON.stringify(h).slice(0, 4000);
  });
  console.log('ATTIVA prima', attivaPrima, 'dopo', snap.activeId, JSON.stringify(snap.tabs.map((t) => [t.id, t.url])));
  console.log('STORIA', storia);
  const chiuse = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs;
    return JSON.stringify(t.closedTabs || t._closed || t.recentlyClosed || null).slice(0, 2000);
  });
  console.log('CHIUSE', chiuse);
});

test('esplora: collega due volte', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  await shell.evaluate(() => window.filoShell.message({ type: 'auth_collega_google' }));
  await indirizzoDellAccesso(app, pagina);
  await shell.evaluate(() => window.filoShell.message({ type: 'auth_collega_google' }));
  await new Promise((r) => setTimeout(r, 2000));
  console.log('SCHEDE COLLEGA', (await schedeSu(app, pagina)).length);
});
