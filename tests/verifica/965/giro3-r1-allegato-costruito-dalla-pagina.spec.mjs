// #965 giro 3, rilievo 1: un file travestito che la pagina costruisce da sé (blob, come WhatsApp Web, Telegram Web,
// la posta cifrata) scende senza l'avviso «File travestito», anche se il suo nome è noto prima che scenda.
import { test, expect } from '../../fixtures/electron.mjs';
import { copertura, vistaAvviso } from '../../helpers/avvisoSito.mjs';

const fuoco = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
  win.focus();
  win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId).view.webContents.focus();
});

const contaScaricamenti = (app) => app.evaluate(({ BrowserWindow }) => {
  globalThis.__scaricamenti = [];
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const ses = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.session;
  ses.on('will-download', (e, item) => { globalThis.__scaricamenti.push({ nome: item.getFilename(), fermato: e.defaultPrevented }); });
});
const scaricamenti = (app) => app.evaluate(() => globalThis.__scaricamenti);

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

const PAGINA = (href) => '<title>Chat</title><button id="scarica">fattura.pdf.exe</button><script>'
  + 'document.getElementById("scarica").onclick = function () {'
  + ` var a = document.createElement("a"); a.href = ${href}; a.download = "fattura.pdf.exe"; document.body.appendChild(a); a.click(); };`
  + '</script>';

for (const [tipo, href] of [
  ['blob', 'URL.createObjectURL(new Blob(["MZ00"], { type: "application/octet-stream" }))'],
  ['data', '"data:application/octet-stream;base64,TVowMA=="'],
]) {
  test(`r1 allegato travestito costruito dalla pagina (${tipo}): l'avviso lo ferma prima che scenda`, async ({ app, openTab, testServer }) => {
    await testServer.openReady(openTab, PAGINA(href));
    await fuoco(app);
    await contaScaricamenti(app);
    await clic(app, '#scarica');
    await expect.poll(() => scaricamenti(app), { timeout: 8000 }).not.toEqual([]);
    expect(await scaricamenti(app)).toEqual([{ nome: 'fattura.pdf.exe', fermato: true }]);
    await expect.poll(async () => (await copertura(app)).coperta).toBe(true);
    const avviso = await vistaAvviso(app);
    await expect(avviso.getByText('File travestito')).toBeVisible();
  });
}
