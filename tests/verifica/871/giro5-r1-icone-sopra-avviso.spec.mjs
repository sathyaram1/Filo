// #871 giro 5, rilievo 1 — sopra l'avviso del sito pericoloso le icone della pagina portate nella barra non devono
// agire sulla pagina segnalata nascosta: niente QR invisibile, niente «Salva per dopo» che la salva e chiude la scheda.
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo, mettiNelMenu } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SEGNALATA = '<title>Accedi</title><body style="margin:0"><h1>Accedi al conto</h1><input type="password"></body>';
const coperta = (app) => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.avvisoSito.coperta());
const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.tabs.map((t) => t.view.webContents.getURL()));

async function apriSegnalata(app, shell) {
  await app.evaluate(async ({ session, net }, html) => {
    const risposta = (req) => (new URL(req.url).hostname === 'conto-paypa1.com'
      ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      : net.fetch(req, { bypassCustomProtocolHandlers: true }));
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: async () => ({ listed: true, category: 'phishing' }), rdap: null, ct: null, sandbox: null, llm: async () => ({ suspicious: false }) });
  }, SEGNALATA);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'https://conto-paypa1.com/login');
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'conto-paypa1.com'; } catch (_) { return false; } }); return !!page; }).toBe(true);
  await expect.poll(() => coperta(app), { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 }).catch(() => {});
  return page;
}

async function premiNellaBarra(app, barra, id) {
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator(`#nav .ico[data-id="${id}"]`).click({ force: true });
}

test('r1 QR e «Salva per dopo» dalla barra non toccano la pagina segnalata nascosta dall\'avviso', async ({ app, shell }) => {
  await mettiNelMenu(app, ['qrCode', 'saveForLater'], 'bar');
  const page = await apriSegnalata(app, shell);
  const barra = await barraPage(app);

  await premiNellaBarra(app, barra, 'qrCode');
  await pausa(1500);
  // Il QR finirebbe dietro l'avviso: l'utente non lo vede, e alla conferma se lo ritrova lì.
  expect(await page.locator('.sn-qr-overlay').count()).toBe(0);

  await premiNellaBarra(app, barra, 'saveForLater');
  await pausa(5500);
  const salvati = await app.evaluate(async () => globalThis.__filoHandlers.handleMessage({ type: globalThis.SN_MSG.MSG.GET_SAVED_PAGES }, { url: 'filo://newtab/' }));
  expect((salvati.pages || []).map((p) => p.url)).not.toContain('https://conto-paypa1.com/login');
  // La conferma del salvataggio sta dietro l'avviso, e dopo quattro secondi la scheda sparisce senza un perché.
  expect(await schede(app)).toContain('https://conto-paypa1.com/login');
  expect(await coperta(app)).toBe(true);
});
