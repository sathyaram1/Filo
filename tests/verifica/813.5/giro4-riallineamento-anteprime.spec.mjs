// Riallineamento di #813.5 su main con le anteprime delle schede (#430): l'avviso del sito pericoloso resta sopra e
// tiene la tastiera mentre una scheda aperta dietro si allarga per la sua foto, e nascondere/riprendere la scheda
// davanti nasconde e rimette l'avviso insieme alle anteprime.

import { test, expect } from '../../fixtures/electron.mjs';

const MODULO = '<title>Accedi</title><form><input name="email" placeholder="Email">'
  + '<input type="password" id="pw" name="pw" placeholder="Password"><button>Accedi</button></form>';
const DIETRO = '<!doctype html><title>Dietro</title><style>html,body{margin:0;height:100%;background:#10a020}</style><h1>Dietro</h1>';

async function servi(app) {
  await app.evaluate(async ({ session, net }, pg) => {
    const risposta = (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    globalThis.SN_SAFEBROWSE.setProviders({
      gsb: async (u) => ({ listed: /paypa1/.test(String(u)), category: 'phishing' }),
      rdap: null, ct: null, sandbox: null,
      llm: async () => ({ suspicious: false, reason: null }),
    });
  }, { 'conto-paypa1.com/login': MODULO, 'giardino-verde.example/': DIETRO });
}

function stato(app) {
  return app.evaluate(({ BrowserWindow, webContents }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    const v = tm.avvisoSito.vista;
    const figli = w.contentView.children;
    const vb = v ? v.getBounds() : null;
    const tb = tab.view.getBounds();
    const dietro = tm.tabs.find((t) => /giardino-verde/.test(t.view.webContents.getURL()));
    const col = webContents.getFocusedWebContents();
    return {
      coperta: tm.avvisoSito.coperta() === tab,
      avvisoInCima: !!v && figli[figli.length - 1] === v,
      avvisoVisibile: !!v && v.getVisible() && vb.width > 0 && vb.width === tb.width && vb.height === tb.height,
      tastiera: v && col === v.webContents ? 'avviso' : (col === tab.view.webContents ? 'pagina' : 'altro'),
      dietroSotto: dietro ? figli.indexOf(dietro.view) < figli.indexOf(tab.view) : null,
      fotoDietro: dietro ? !!tm.anteprime.get(dietro.id) : null,
    };
  });
}

test('avviso sopra e con la tastiera mentre una scheda dietro si fotografa; nascosto e rimesso con la scheda davanti', async ({ app, shell }) => {
  await servi(app);
  await shell.evaluate(() => window.filoShell.tabs.open('https://conto-paypa1.com/login'));
  await expect.poll(async () => { const s = await stato(app); return s.coperta && s.avvisoVisibile && s.avvisoInCima; }, { timeout: 15_000 }).toBe(true);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.openTab('https://giardino-verde.example/', { activate: false }));
  await expect.poll(async () => (await stato(app)).fotoDietro, { timeout: 15_000 }).toBe(true);
  const conFoto = await stato(app);
  expect(conFoto).toMatchObject({ coperta: true, avvisoInCima: true, avvisoVisibile: true, dietroSotto: true });

  await shell.evaluate(() => window.filoShell.tabs.setActiveVisible(false));
  await expect.poll(async () => (await stato(app)).avvisoVisibile).toBe(false);

  await shell.evaluate(() => window.filoShell.tabs.setActiveVisible(true));
  await expect.poll(async () => { const s = await stato(app); return s.coperta && s.avvisoVisibile && s.avvisoInCima; }).toBe(true);
});
