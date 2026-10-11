// #814 giro 8: un indirizzo scritto nella barra della home è chiesto dall'utente quanto un clic: la pagina di
// ringraziamento che apre fa partire il programma per sua richiesta, e non deve prendere «Scaricamento partito da solo».

import { test, expect } from '../../fixtures/electron.mjs';

const EXE = 'MZ finto eseguibile di prova\n' + 'z'.repeat(2048);

async function servi(app, pagine) {
  await app.evaluate(async ({ session, net }, { pg, exe }) => {
    const nostri = new Set(Object.keys(pg).map((k) => k.split('/')[0]));
    const risposta = (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (/\.exe$/i.test(u.pathname)) {
        const nome = decodeURIComponent(u.pathname.split('/').pop());
        return new Response(exe, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${nome}"` } });
      }
      if (nostri.has(u.hostname)) return new Response('', { status: 404 });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, ct: null, sandbox: null, rdap: async () => null, llm: async () => ({ suspicious: false }) });
  }, { pg: pagine, exe: EXE });
}

const livelloDi = (app, host) => app.evaluate(({ BrowserWindow }, h) => {
  for (const w of BrowserWindow.getAllWindows()) {
    for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
      let qui = '';
      try { qui = new URL(t.view.webContents.getURL()).hostname; } catch (_) {}
      if (qui === h) return { level: t.sbLevel || 'safe', title: (t.sbAvviso && t.sbAvviso.message && t.sbAvviso.message.title) || '' };
    }
  }
  return { level: 'nessuna scheda', title: '' };
}, host);

const statoDi = async (shell, nome) => ((((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [])
  .find((it) => it.filename === nome) || {}).state ?? null;

test('r2 indirizzo di una pagina di ringraziamento scritto nella barra della home: nessun avviso', async ({ app, shell }) => {
  await servi(app, {
    'programmi-scritti.it/grazie': '<p>Grazie, il download partirà a breve</p>'
      + '<script>setTimeout(() => { location.href = "/setup.exe"; }, 1000);</script>',
  });
  let home = null;
  for (let i = 0; i < 100 && !home; i++) {
    home = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (!home && i === 0) await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    if (!home) await new Promise((r) => setTimeout(r, 100));
  }
  await home.waitForLoadState('domcontentloaded');
  await home.evaluate(() => new Promise((ok) => chrome.runtime.sendMessage(
    { type: 'open_url', url: 'https://programmi-scritti.it/grazie', parole: ['programmi-scritti.it/grazie'] }, ok)));
  await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 10000 }).toBe('pending');
  await new Promise((r) => setTimeout(r, 2500));
  const a = await livelloDi(app, 'programmi-scritti.it');
  expect(a.level, a.title).toBe('safe');
});
