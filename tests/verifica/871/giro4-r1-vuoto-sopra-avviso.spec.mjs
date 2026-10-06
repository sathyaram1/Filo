// #871 giro 4, rilievo 1 — la barra aperta sopra l'avviso del sito pericoloso: i gesti che cadono nel suo
// vuoto (l'ombra accanto al pannello) non devono arrivare alla pagina segnalata nascosta sotto l'avviso.

import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

// La pagina segnalata: un pulsante grande quanto la pagina, e il conto dei gesti che riceve.
const PAGINA = '<title>Accedi</title><body style="margin:0;height:3000px"><button id="b" style="position:fixed;inset:0;width:100%;height:100%">Accedi</button>'
  + '<script>window.__g={giu:0,clic:0,menu:0,rotella:0};'
  + 'document.addEventListener("mousedown",function(){__g.giu++},true);'
  + 'document.addEventListener("click",function(){__g.clic++},true);'
  + 'document.addEventListener("contextmenu",function(){__g.menu++},true);'
  + 'document.addEventListener("wheel",function(){__g.rotella++},true);</script></body>';

async function servi(app) {
  await app.evaluate(async ({ session, net }, html) => {
    const risposta = (req) => {
      const u = new URL(req.url);
      if (u.hostname === 'conto-paypa1.com') return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: async () => ({ listed: true, category: 'phishing' }), rdap: null, ct: null, sandbox: null, llm: async () => ({ suspicious: false }) });
  }, PAGINA);
}

function nelVuoto(app, eventi) {
  return app.evaluate(({ BrowserWindow }, ev) => {
    const w = BrowserWindow.getAllWindows().find((q) => q._filoTabs && !q._filoIncognito);
    const wc = w._filoTabs.barra.vista.webContents;
    for (const e of ev) wc.sendInputEvent(e);
  }, eventi);
}

test('r1 barra aperta sopra l\'avviso: clic, tasto destro e rotella nel vuoto non arrivano alla pagina segnalata', async ({ app, shell }) => {
  await servi(app);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'https://conto-paypa1.com/login');
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'conto-paypa1.com'; } catch (_) { return false; } }); return !!page; }).toBe(true);
  const coperta = () => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.avvisoSito.coperta());
  await expect.poll(coperta, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => !!window.__g);
  const barra = await barraPage(app);

  // L'utente apre la barra sopra l'avviso per tornare indietro, poi ci ripensa e clicca accanto.
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  const x = 56 + 8;
  await nelVuoto(app, [
    { type: 'mouseMove', x, y: 200 },
    { type: 'mouseWheel', x, y: 200, deltaX: 0, deltaY: -400 },
    { type: 'mouseDown', x, y: 200, button: 'right', clickCount: 1 },
    { type: 'mouseUp', x, y: 200, button: 'right', clickCount: 1 },
  ]);
  await page.waitForTimeout(400);
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  await nelVuoto(app, [
    { type: 'mouseMove', x, y: 260 },
    { type: 'mouseDown', x, y: 260, button: 'left', clickCount: 1 },
    { type: 'mouseUp', x, y: 260, button: 'left', clickCount: 1 },
  ]);
  await page.waitForTimeout(800);
  expect(await coperta()).toBe(true);
  expect(await page.evaluate(() => window.__g)).toEqual({ giu: 0, clic: 0, menu: 0, rotella: 0 });
});
