// Esplorazione del giro 4 di #965: le altre porte del clic su un link da avviso.
import { test, expect } from '../../fixtures/electron.mjs';
import { vistaAvviso, copertura } from '../../helpers/avvisoSito.mjs';

async function contaLaRete(app) {
  await app.evaluate(async ({ session, net }) => {
    globalThis.__richieste = [];
    const risposta = (req) => {
      globalThis.__richieste.push(req.url);
      const u = new URL(req.url);
      if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) return new Response('<title>Arrivato</title><p id="arrivato">arrivato</p>', { headers: { 'content-type': 'text/html' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    const nulla = async () => null;
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: nulla, gsbPeek: null, rdap: nulla, ct: nulla, llm: nulla, sandbox: nulla });
  });
}
const verso = (app, h) => app.evaluate((_, x) => globalThis.__richieste.filter((u) => { try { return new URL(u).hostname.endsWith(x); } catch (_) { return false; } }), h);
const schedeWeb = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w._filoTabs.tabs.map((t) => t.view.webContents.getURL()).filter((u) => /^https?:/.test(u));
});
const fuoco = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
  win.focus();
  win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId).view.webContents.focus();
});
async function clic(app, sel, { button = 'left', modifiers = [], frame = false } = {}) {
  await app.evaluate(async ({ BrowserWindow }, { sel: s, button: b, m, frame: f }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const wc = win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId).view.webContents;
    const r = await wc.executeJavaScript(`(() => { let el; const f = ${f};
      if (f) { const fr = document.querySelector('iframe'); const b0 = fr.getBoundingClientRect(); el = fr.contentDocument.querySelector(${JSON.stringify(s)}); const b = el.getBoundingClientRect(); return { x: Math.round(b0.x + b.x + b.width / 2), y: Math.round(b0.y + b.y + b.height / 2) }; }
      el = ${JSON.stringify(s)}.startsWith('shadow:') ? document.querySelector('#host').shadowRoot.querySelector('a') : document.querySelector(${JSON.stringify(s)});
      el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    const p = { x: r.x, y: r.y, button: b, clickCount: 1, modifiers: m };
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    wc.sendInputEvent({ type: 'mouseDown', ...p });
    wc.sendInputEvent({ type: 'mouseUp', ...p });
  }, { sel, button, m: modifiers, frame });
}
async function invio(app, sel) {
  await app.evaluate(async ({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const wc = win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId).view.webContents;
    await wc.executeJavaScript(`document.querySelector(${JSON.stringify(s)}).focus()`);
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    wc.sendInputEvent({ type: 'char', keyCode: '\r' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  }, sel);
}

const PAGINA = '<title>Forum</title><p><a id="t" href="https://paypa1.com/login">truffa</a></p>'
  + '<p><a id="ok" href="https://www.wikipedia.org/wiki/Gatto">gatto</a></p>'
  + '<p><a id="apple" href="https://apple.co/3abcdef">ascolta su Apple Music</a></p>'
  + '<div id="host"></div><iframe srcdoc="<a id=&quot;f&quot; target=&quot;_top&quot; href=&quot;https://paypa1.com/frame&quot;>dal riquadro</a>"></iframe>'
  + '<script>document.getElementById("host").attachShadow({mode:"open"}).innerHTML = \'<a href="https://paypa1.com/ombra">ombra</a>\';</script>';

for (const [nome, fa] of [
  ['Invio da tastiera', (app) => invio(app, '#t')],
  ['clic centrale', (app) => clic(app, '#t', { button: 'middle' })],
  ['Maiusc+clic', (app) => clic(app, '#t', { modifiers: ['shift'] })],
  ['link nel riquadro verso la pagina intera', (app) => clic(app, '#f', { frame: true })],
  ['link dentro un componente (shadow DOM)', (app) => clic(app, 'shadow:a')],
]) {
  test(`porta: ${nome} su un link da avviso`, async ({ app, openTab, testServer }) => {
    await contaLaRete(app);
    const pagina = await testServer.openReady(openTab, PAGINA);
    await fuoco(app);
    await pagina.waitForTimeout(800);
    await fa(app);
    const avviso = await vistaAvviso(app);
    await expect(avviso.getByText('Attenzione: questo non è PayPal')).toBeVisible();
    await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
    expect(await verso(app, 'paypa1.com')).toEqual([]);
    expect((await schedeWeb(app)).filter((u) => u.includes('paypa1'))).toEqual([]);
  });
}

test('link qualunque: si apre senza avviso', async ({ app, openTab, testServer }) => {
  await contaLaRete(app);
  const pagina = await testServer.openReady(openTab, PAGINA);
  await fuoco(app);
  await clic(app, '#ok');
  await expect.poll(async () => (await schedeWeb(app))[0]).toContain('wikipedia.org');
  expect((await copertura(app)).coperta).toBe(false);
});

test('apple.co (accorciatore ufficiale di Apple): si apre senza avviso', async ({ app, openTab, testServer }) => {
  await contaLaRete(app);
  await testServer.openReady(openTab, PAGINA);
  await fuoco(app);
  await clic(app, '#apple');
  await new Promise((r) => setTimeout(r, 1500));
  expect((await copertura(app)).coperta).toBe(false);
  await expect.poll(async () => (await schedeWeb(app))[0]).toContain('apple.co');
});
