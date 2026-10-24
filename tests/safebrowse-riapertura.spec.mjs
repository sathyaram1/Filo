// Il controllo dei siti pericolosi non riapre di nascosto la pagina che l'utente ha aperto (#1081): un link con effetti
// al GET arriva al sito una volta sola. In incognito non parte il giudizio del modello, e l'avviso locale resta.
// Regole: src/main/services/safebrowse/index.js; logica in tests/unit/safebrowseRiaperturaNascosta.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

// Un sito «da internet» (sito-pubblico.test punta al loopback) che conta le visite a ogni percorso.
async function sitoCheConta(t) {
  const visite = [];
  const server = createServer((req, res) => {
    visite.push(req.url);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const password = req.url.startsWith('/accesso') ? '<form><label>Password <input type="password"></label></form>' : '';
    res.end(`<title>SITO1081</title><p>Iscrizione confermata</p>${password}`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after = () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); });
  return { base: `http://sito-pubblico.test:${server.address().port}`, quante: (p) => visite.filter((u) => u.startsWith(p)).length };
}

// Giudice finto che conta e finestra nascosta vera: solo la regola del motore decide se parte.
const accendiControlli = (app) => app.evaluate(() => {
  globalThis.__giudizi1081 = 0;
  globalThis.SN_SAFEBROWSE.configure({
    gsbKey: '', enableNetwork: false, enableSandbox: true,
    runLlm: async () => { globalThis.__giudizi1081++; return '{"suspicious": false, "reason": null}'; },
  });
});
const giudizi = (app) => app.evaluate(() => globalThis.__giudizi1081);

test('una pagina http di conferma aperta in una scheda arriva al sito una volta sola', async ({ app, openTab }) => {
  const t = {};
  const sito = await sitoCheConta(t);
  try {
    await accendiControlli(app);
    const page = await openTab(`${sito.base}/conferma?token=monouso1081`);
    await expect(page).toHaveTitle('SITO1081');
    // Il giudizio parte insieme alla finestra nascosta: quando c'è, tutto il controllo profondo è in corso.
    await expect.poll(() => giudizi(app), { timeout: 10_000 }).toBeGreaterThan(0);
    await app.evaluate(() => globalThis.SN_SAFEBROWSE._settled());
    expect(sito.quante('/conferma')).toBe(1);
  } finally {
    await t.after();
  }
});

test('in incognito una pagina http con la password ha il suo avviso, senza giudizio del modello né seconda visita', async ({ app, shell }) => {
  const t = {};
  const sito = await sitoCheConta(t);
  try {
    await accendiControlli(app);
    const idIncognito = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w._filoIncognito).map((w) => w.id));
    await shell.evaluate(() => window.filoShell.openIncognito());
    let id = null;
    await expect.poll(async () => { id = (await idIncognito())[0] ?? null; return id; }, { timeout: 15_000 }).not.toBeNull();
    const url = `${sito.base}/accesso?token=monouso1081`;
    await app.evaluate(({ BrowserWindow }, a) => { BrowserWindow.fromId(a.id)._filoTabs.openTab(a.url); }, { id, url });
    const avviso = () => app.evaluate(({ BrowserWindow }, a) => {
      const tab = BrowserWindow.fromId(a.id)._filoTabs.tabs.find((x) => x.view?.webContents?.getURL?.() === a.url);
      return tab?.sbAvviso?.level || null;
    }, { id, url });
    await expect.poll(avviso, { timeout: 15_000 }).toBe('sospetto');
    await app.evaluate(() => globalThis.SN_SAFEBROWSE._settled());
    expect(await giudizi(app)).toBe(0);
    expect(sito.quante('/accesso')).toBe(1);
  } finally {
    await t.after();
  }
});
