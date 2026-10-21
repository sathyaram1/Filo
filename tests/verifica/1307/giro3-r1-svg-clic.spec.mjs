// Verifica #1307, giro 3, rilievo 1: il link di un disegno SVG verso un sosia non passa dal controllo prima del clic.
// Il link HTML gemello nella stessa pagina ha il verdetto pronto e al clic il sito non si apre; quello SVG no.

import { test, expect } from '../../fixtures/electron.mjs';
import { vistaAvviso } from '../../helpers/avvisoSito.mjs';

const MODULO = '<title>Accedi</title><form><input name="email"><input type="password" name="pw"><button>Accedi</button></form>';

async function contaLaRete(app, pagine) {
  await app.evaluate(async ({ session, net }, pg) => {
    globalThis.__richieste = [];
    const risposta = (req) => {
      globalThis.__richieste.push(req.url);
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (u.hostname === '127.0.0.1') return net.fetch(req, { bypassCustomProtocolHandlers: true });
      return Response.error();
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    const nulla = async () => null;
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: nulla, gsbPeek: null, rdap: nulla, ct: nulla, llm: nulla, sandbox: nulla });
  }, pagine);
}

const richiesteVerso = (app, host) => app.evaluate((_, h) => globalThis.__richieste.filter((u) => {
  try { return new URL(u).hostname === h; } catch (_) { return false; }
}), host);

const verdettoPronto = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  for (const w of BrowserWindow.getAllWindows()) {
    for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
      const v = t._sbLinkSegnalati && t._sbLinkSegnalati.get(u);
      if (v) return v.level;
    }
  }
  return null;
}, url);

async function clic(app, sel) {
  await app.evaluate(async ({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    win.focus();
    const wc = win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId).view.webContents;
    wc.focus();
    const r = await wc.executeJavaScript(`(() => { const b = document.querySelector(${JSON.stringify(s)}).getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    const p = { x: r.x, y: r.y, button: 'left', clickCount: 1 };
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    wc.sendInputEvent({ type: 'mouseDown', ...p });
    wc.sendInputEvent({ type: 'mouseUp', ...p });
  }, sel);
}

test('r1 un link SVG verso un sosia di PayPal: verdetto pronto come il link HTML, e al clic il sito non si apre', async ({ app, openTab, testServer }) => {
  await contaLaRete(app, { 'paypa1.com/svg': MODULO });
  await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <p><a id="html" href="https://paypa1.com/html">Accedi</a></p>
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><a href="https://paypa1.com/svg"><rect id="disegno" width="320" height="120" fill="#e07b39"/></a></svg>
  </body></html>`);
  await expect.poll(() => verdettoPronto(app, 'https://paypa1.com/html'), { timeout: 8000 }).toBe('pericoloso');
  expect(await verdettoPronto(app, 'https://paypa1.com/svg')).toBe('pericoloso');

  await clic(app, '#disegno');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Attenzione: questo non è PayPal')).toBeVisible();
  expect(await richiesteVerso(app, 'paypa1.com')).toEqual([]);
});
