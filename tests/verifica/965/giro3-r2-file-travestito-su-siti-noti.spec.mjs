// #965 giro 3, rilievo 2: un file travestito ospitato da un sito noto (Dropbox, il CDN di Discord, OneDrive) non ha
// l'avviso «File travestito»: l'elenco dei siti fidati, che certifica chi è il sito, spegne anche il controllo del file.
import { test, expect } from '../../fixtures/electron.mjs';
import { copertura, vistaAvviso } from '../../helpers/avvisoSito.mjs';

async function finti(app, pagine = {}) {
  await app.evaluate(async ({ session, net }, pg) => {
    const risposta = (req) => {
      const u = new URL(req.url);
      if (pg[u.hostname + u.pathname]) {
        return new Response('MZ00', { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${u.pathname.split('/').pop()}"` } });
      }
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    const nulla = async () => null;
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: nulla, gsbPeek: null, rdap: nulla, ct: nulla, llm: nulla, sandbox: nulla });
  }, pagine);
}

const fuoco = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
  win.focus();
  win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId).view.webContents.focus();
});

async function clic(app, sel) {
  await app.evaluate(async ({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const wc = win._filoTabs.tabs.find((x) => x.id === win._filoTabs.activeId).view.webContents;
    const r = await wc.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(s)});
      el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    const p = { x: r.x, y: r.y, button: 'left', clickCount: 1 };
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    wc.sendInputEvent({ type: 'mouseDown', ...p });
    wc.sendInputEvent({ type: 'mouseUp', ...p });
  }, sel);
}

for (const [nome, url] of [
  ['Dropbox', 'https://www.dropbox.com/s/abc/fattura.pdf.exe'],
  ['Discord', 'https://cdn.discordapp.com/attachments/1/2/fattura.pdf.exe'],
]) {
  test(`r2 file travestito su ${nome}: al clic l'avviso nomina il file`, async ({ app, openTab, testServer }) => {
    const u = new URL(url);
    await finti(app, { [u.hostname + u.pathname]: true });
    await testServer.openReady(openTab, `<title>Chat</title><a id="file" href="${url}">fattura di marzo</a>`);
    await fuoco(app);
    await clic(app, '#file');
    await expect.poll(async () => (await copertura(app)).coperta, { timeout: 8000 }).toBe(true);
    const avviso = await vistaAvviso(app);
    await expect(avviso.getByText('File travestito')).toBeVisible();
  });
}
