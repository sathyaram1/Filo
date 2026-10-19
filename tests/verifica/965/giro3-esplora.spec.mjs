// Esplorazione del giro 3 di #965: porte equivalenti del clic e file travestiti su siti noti.
import { test, expect } from '../../fixtures/electron.mjs';
import { vistaAvviso, copertura } from '../../helpers/avvisoSito.mjs';

async function finti(app, pagine = {}) {
  await app.evaluate(async ({ session, net }, pg) => {
    globalThis.__richieste = [];
    const risposta = (req) => {
      globalThis.__richieste.push(req.url);
      const u = new URL(req.url);
      const p = pg[u.hostname + u.pathname];
      if (p === 'EXE') {
        return new Response('MZ00', { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${u.pathname.split('/').pop()}"` } });
      }
      if (p) return new Response(p, { headers: { 'content-type': 'text/html; charset=utf-8' } });
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

const schedeWeb = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w._filoTabs.tabs.map((t) => t.view.webContents.getURL()).filter((u) => /^https?:/.test(u));
});

const contaScaricamenti = (app) => app.evaluate(({ BrowserWindow }) => {
  globalThis.__scaricamenti = [];
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const ses = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.session;
  ses.on('will-download', (e, item) => { globalThis.__scaricamenti.push({ nome: item.getFilename(), fermato: e.defaultPrevented }); });
});
const scaricamenti = (app) => app.evaluate(() => globalThis.__scaricamenti);

async function input(app, sel, tipo) {
  await app.evaluate(async ({ BrowserWindow }, { sel: s, tipo: t }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const wc = win._filoTabs.tabs.find((x) => x.id === win._filoTabs.activeId).view.webContents;
    const r = await wc.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(s)});
      el.scrollIntoView({ block: 'center' }); el.focus(); const b = el.getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    if (t === 'enter') {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      wc.sendInputEvent({ type: 'char', keyCode: '\r' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
      return;
    }
    const p = { x: r.x, y: r.y, button: t === 'middle' ? 'middle' : 'left', clickCount: 1 };
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    wc.sendInputEvent({ type: 'mouseDown', ...p });
    wc.sendInputEvent({ type: 'mouseUp', ...p });
  }, { sel, tipo });
}

test('clic centrale su un link da avviso: avviso, nessuna scheda', async ({ app, openTab, testServer }) => {
  await finti(app, { 'paypa1.com/premio': '<p>premio</p>' });
  const pagina = await testServer.openReady(openTab, '<title>Lista</title><a id="truffa" href="https://paypa1.com/premio">premio</a>');
  await fuoco(app);
  const forum = pagina.url();
  await input(app, '#truffa', 'middle');
  await expect.poll(async () => (await copertura(app)).coperta, { timeout: 8000 }).toBe(true);
  expect(await schedeWeb(app)).toEqual([forum]);
});

test('Invio da tastiera su un link da avviso: avviso, la pagina resta', async ({ app, openTab, testServer }) => {
  await finti(app, { 'paypa1.com/premio': '<p>premio</p>' });
  const pagina = await testServer.openReady(openTab, '<title>Lista</title><a id="truffa" href="https://paypa1.com/premio">premio</a>');
  await fuoco(app);
  const forum = pagina.url();
  await input(app, '#truffa', 'enter');
  await expect.poll(async () => (await copertura(app)).coperta, { timeout: 8000 }).toBe(true);
  expect(await schedeWeb(app)).toEqual([forum]);
});

test('«Salva file» dal tasto destro su un file travestito: avviso, il file non scende', async ({ app, openTab, testServer }) => {
  await finti(app, { 'archivio-documenti.example.com/fattura.pdf.exe': 'EXE' });
  const pagina = await testServer.openReady(openTab, '<title>Posta</title>'
    + '<a id="file" href="https://archivio-documenti.example.com/fattura.pdf.exe">la tua fattura</a>');
  await fuoco(app);
  await contaScaricamenti(app);
  await pagina.locator('#file').click({ button: 'right' });
  const menu = pagina.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 20_000 });
  await menu.locator('.sn-menu-item', { hasText: 'Salva file' }).first().click({ noWaitAfter: true });
  await expect.poll(async () => (await copertura(app)).coperta, { timeout: 8000 }).toBe(true);
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('File travestito')).toBeVisible();
  expect((await scaricamenti(app)).filter((s) => !s.fermato)).toEqual([]);
});

for (const [nome, url] of [
  ['Dropbox', 'https://www.dropbox.com/s/abc/fattura.pdf.exe'],
  ['Discord', 'https://cdn.discordapp.com/attachments/1/2/fattura.pdf.exe'],
  ['OneDrive', 'https://onedrive.live.com/download/fattura.pdf.exe'],
]) {
  test(`file travestito su ${nome}: al clic l'avviso nomina il file`, async ({ app, openTab, testServer }) => {
    const u = new URL(url);
    await finti(app, { [u.hostname + u.pathname]: 'EXE' });
    await testServer.openReady(openTab, `<title>Chat</title><a id="file" href="${url}">fattura di marzo</a>`);
    await fuoco(app);
    await contaScaricamenti(app);
    await input(app, '#file', 'left');
    await expect.poll(async () => (await copertura(app)).coperta, { timeout: 8000 }).toBe(true);
    const avviso = await vistaAvviso(app);
    await expect(avviso.getByText('File travestito')).toBeVisible();
    expect((await scaricamenti(app)).filter((s) => !s.fermato)).toEqual([]);
  });
}
