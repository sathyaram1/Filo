// Verifica #1053 giro 1: esplorazione dello strato del menu (acceso dalle prove).
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

test.use({ stratoDelMenu: true });

const PAGINA = `<!doctype html><html><body style="margin:0;background:#c33">
  <div id="bersaglio" style="position:absolute;left:200px;top:120px;width:120px;height:60px;background:#eed">bersaglio</div>
  <input id="campo" style="position:absolute;left:20px;top:20px">
  <script>window.visti=[];addEventListener('mousedown',e=>visti.push(e.button),true);</script></body></html>`;

const tm = (app, fn, arg) => app.evaluate(({ BrowserWindow, webContents, nativeTheme, Menu }, { fn, arg }) => {
  // eslint-disable-next-line no-new-func
  return new Function('ctx', 'arg', `return (${fn})(ctx, arg)`)({ BrowserWindow, webContents, nativeTheme, Menu }, arg);
}, { fn: fn.toString(), arg });

async function pronto(app) {
  await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
}

async function apri(app, page) {
  await page.mouse.click(260, 150, { button: 'right' });
  await expect.poll(async () => (await statoDelloStrato(app))?.aperto).toBe(true);
}

const chiusoPresto = async (app) => {
  await expect.poll(async () => { const s = await statoDelloStrato(app); return s && !s.aperto && !s.visibile; }, { timeout: 3000 }).toBe(true);
};

test('trasparente in tema chiaro e scuro: fuori dal menu si vede la pagina', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html(PAGINA));
  await pronto(app);
  const strato = await paginaDelloStrato(app);
  for (const tema of ['light', 'dark']) {
    await tm(app, ({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, tema);
    await apri(app, page);
    const sfondi = await strato.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor]);
    expect(sfondi, tema).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
    const alfa = await tm(app, async ({ BrowserWindow }) => {
      const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      const img = await t.strato.vista.webContents.capturePage({ x: 10, y: 300, width: 4, height: 4 });
      const bmp = img.toBitmap();
      return { a: bmp[3], vuota: img.isEmpty() };
    });
    console.log('alfa', tema, JSON.stringify(alfa));
    await page.keyboard.press('Escape');
    await chiusoPresto(app);
  }
});

test('clic sulla barra in alto e finestra che perde il fuoco chiudono lo strato', async ({ app, shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(PAGINA));
  await pronto(app);
  await apri(app, page);
  await tm(app, ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    for (const t of ['mouseDown', 'mouseUp']) w.webContents.sendInputEvent({ type: t, x: 300, y: 10, button: 'left', clickCount: 1 });
  });
  await chiusoPresto(app);
  await apri(app, page);
  await tm(app, ({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs).emit('blur'); });
  await chiusoPresto(app);
  await apri(app, page);
  await tm(app, ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); const b = w.getBounds(); w.setBounds({ ...b, width: b.width - 80 }); });
  await chiusoPresto(app);
});

test('Esc con la tastiera nella barra degli indirizzi chiude lo strato', async ({ app, shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(PAGINA));
  await pronto(app);
  await apri(app, page);
  await tm(app, ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.webContents.focus();
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await chiusoPresto(app);
});

test('barra laterale aperta a strato aperto: il clic nella barra chiude lo strato', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html(PAGINA));
  await pronto(app);
  await apri(app, page);
  const dopo = await tm(app, async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs;
    t.barra.apri('tasto');
    await new Promise((r) => setTimeout(r, 800));
    const figli = w.contentView.children;
    return {
      aperto: t.strato.stato().aperto,
      stratoInCima: figli[figli.length - 1] === t.strato.vista,
      barraBounds: t.barra.vista && t.barra.vista.getBounds(),
      stratoBounds: t.strato.vista.getBounds(),
      ordine: figli.map((v) => { try { return v.webContents.getURL().slice(0, 40); } catch (_) { return '?'; } }),
    };
  });
  console.log('barra', JSON.stringify(dopo));
  if (dopo.aperto && !dopo.stratoInCima) {
    await tm(app, ({ BrowserWindow }) => {
      const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
      for (const ty of ['mouseDown', 'mouseUp']) t.barra.vista.webContents.sendInputEvent({ type: ty, x: 40, y: 200, button: 'left', clickCount: 1 });
    });
  }
  await chiusoPresto(app);
});

test('sito che blocca il tasto destro: lo strato si apre come il menu di oggi', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html(`<!doctype html><html><body style="margin:0" oncontextmenu="return false">
    <div id="bersaglio" style="position:absolute;left:200px;top:120px;width:120px;height:60px">x</div>
    <script>document.addEventListener('contextmenu', (e) => e.preventDefault());</script></body></html>`));
  await pronto(app);
  await page.mouse.click(260, 150, { button: 'right' });
  await expect.poll(async () => (await statoDelloStrato(app))?.aperto, { timeout: 3000 }).toBe(true);
});

test('seconda finestra: lo strato nasce e si apre anche lì', async ({ app, openTab, testServer }) => {
  await openTab(testServer.html(PAGINA));
  await pronto(app);
  const prima = (await app.windows()).length;
  await tm(app, ({ Menu }) => {
    const giro = (m) => { for (const i of m.items) { if (i.accelerator === 'CommandOrControl+N' || i.accelerator === 'CmdOrCtrl+N') { i.click(); return true; } if (i.submenu && giro(i.submenu)) return true; } return false; };
    return giro(Menu.getApplicationMenu());
  });
  await expect.poll(() => tm(app, ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w._filoTabs).length)).toBe(2);
  await expect.poll(() => tm(app, ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w._filoTabs && w._filoTabs.strato.stato().pronta).length), { timeout: 10000 }).toBe(2);
  console.log('finestre', prima, (await app.windows()).length);
});
