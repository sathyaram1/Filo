// Verifica #2611 giro 1: l'avviso dei giudici fermi nato mentre la cornice ha finito il caricamento della pagina ma
// non si è ancora fermata (isLoading acceso dopo did-finish-load) deve arrivare quando si ferma, non restare in coda.

import { test, expect } from '../../fixtures/electron.mjs';

const EPISODIO = { causa: 'credit', da: '2026-11-20T08:00:00.000Z', ultimoErrore: '2026-11-20T08:30:00.000Z', inAttesa: 7 };

async function owner(app, stato) {
  await app.evaluate(async (_e, stato) => {
    const M = process.getBuiltinModule('module');
    const mod = (re) => M._cache[Object.keys(M._cache).find((x) => re.test(x))].exports;
    const ga = mod(/auth[\\/]google-auth\.js$/);
    ga.isAdmin = () => true;
    ga.isSignedIn = () => true;
    ga.accessoOwnerCaduto = () => false;
    ga.getIdToken = async () => 'token-finto-dell-owner';
    globalThis.__giudici = stato;
    mod(/services[\\/]defaultsStore\.js$/).getGiudiciFermi = async () => ({ risposto: true, raw: globalThis.__giudici });
  }, stato);
}

const cornici = (app, fn) => app.evaluate(({ BrowserWindow }, corpo) => {
  const f = new Function('wc', corpo);
  for (const w of BrowserWindow.getAllWindows()) if (w._filoTabs && !w.isDestroyed()) f(w.webContents);
}, fn);

test('un avviso nato fra la fine del caricamento della cornice e il suo arresto arriva appena si ferma', async ({ app, shell, avvisi }) => {
  test.setTimeout(60_000);
  await shell.waitForLoadState('load');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter((w) => w._filoTabs).every((w) => !w.webContents.isLoading())), { timeout: 15_000 }).toBe(true);

  // did-finish-load è già passato; la cornice risulta ancora in caricamento, come con un sotto-documento lento.
  await cornici(app, 'wc.isLoading = () => true;');
  await owner(app, EPISODIO);
  await app.evaluate(() => globalThis.SN_GIUDICI_FERMI.colpo('prova'));
  await new Promise((r) => setTimeout(r, 500));
  await cornici(app, 'delete wc.isLoading; wc.emit("did-stop-loading");');

  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'I giudici sono senza credito' })).toHaveCount(1, { timeout: 10_000 });
});
