// Verifica #1592 giro 1: esplorazione dal lato dell'utente qualunque (mai entrato con Google) e del ritorno.
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ inPausaAperte: false });

let server;
let base = '';
const docs = {};

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url.split('?')[0];
    const doc = url.includes('/databases/(default)/documents/') ? url.split('/databases/(default)/documents/')[1] : '';
    res.writeHead(doc && !docs[doc] && (doc === 'config/bacheca' || doc === 'config/mazzi') ? 404 : 200, { 'Content-Type': 'application/json' });
    if (doc === 'config/bacheca' || doc === 'config/mazzi') {
      return res.end(JSON.stringify(docs[doc] ? { name: doc, fields: { openToAll: { booleanValue: docs[doc].openToAll } } } : { error: { code: 404 } }));
    }
    res.end(JSON.stringify({ name: doc, fields: {} }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

async function prepara(app) {
  await app.evaluate((_, indirizzo) => {
    if (globalThis.__f1592) return;
    const vero = globalThis.fetch;
    globalThis.__f1592 = vero;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/firestore\.googleapis\.com/, indirizzo), init);
  }, base);
}
async function rileggi(app) {
  return app.evaluate(async () => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const P = req('./services/inPausa');
    const out = {};
    for (const n of P.NOMI) { await P.cancello(n).rileggiOra(); out[n] = (await P.cancello(n).rileggiOra()).visible; }
    return out;
  });
}
async function home(app) {
  let win = null;
  await expect.poll(() => Boolean(win = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } }))).toBe(true);
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#tieni .dash-carta[data-chiave="editor"]')).toBeVisible({ timeout: 10_000 });
  return win;
}

test('mai entrato, Mazzi tolti prima: niente in «altro»; aperti dall\'owner la carta torna senza ricaricare', async ({ app, openTab }) => {
  docs['config/bacheca'] = { openToAll: false };
  docs['config/mazzi'] = { openToAll: false };
  await prepara(app);
  const h0 = await home(app);
  // L'utente aveva tolto la carta dei Mazzi quando era visibile.
  await h0.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.CARTE_HOME_MODIFICA, mossa: { tipo: 'togli', carta: 'mazzi' } }));
  expect(await rileggi(app)).toEqual({ bacheca: false, mazzi: false });
  const h = await home(app);
  await expect(h.locator('#altro')).not.toContainText(/Mazzi|Bacheca/);
  await expect(h.locator('#tieni .dash-carta[data-chiave="mazzi"]')).toHaveCount(0);
  mkdirSync('tests/.shots', { recursive: true });
  await h.screenshot({ path: 'tests/.shots/v1592-home.png' });

  // Rimessa la carta, poi l'owner apre i Mazzi: la carta compare senza ricaricare.
  await h.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.CARTE_HOME_MODIFICA, mossa: { tipo: 'aggiungi', carta: 'mazzi' } }));
  docs['config/mazzi'] = { openToAll: true };
  expect(await rileggi(app)).toEqual({ bacheca: false, mazzi: true });
  await expect(h.locator('#tieni .dash-carta[data-chiave="mazzi"]')).toBeVisible({ timeout: 10_000 });

  // La pagina dei Modelli, per chi non vede i Mazzi.
  docs['config/mazzi'] = { openToAll: false };
  expect(await rileggi(app)).toEqual({ bacheca: false, mazzi: false });
  const o = await openTab('filo://options/options.html');
  await o.waitForSelector('#useDefaultModels', { timeout: 8000 });
  await o.waitForTimeout(1500);
  const prima = await o.evaluate(() => document.body.innerText);
  console.log('MODELLI-MAZZI-PRIMA', (prima.match(/[^\n]*Mazzi[^\n]*/g) || []).join(' | '));
  await o.uncheck('#useDefaultModels');
  await o.waitForTimeout(1500);
  const testo = await o.evaluate(() => document.body.innerText);
  console.log('MODELLI-MAZZI', (testo.match(/[^\n]*Mazzi[^\n]*/g) || []).join(' | '));
  await o.screenshot({ path: 'tests/.shots/v1592-modelli.png', fullPage: true });
});
