// #871 giro 5 — esplorazione del verificatore: cambio di scheda a barra aperta, vuoto su pagina zoomata,
// scorciatoia mentre si scrive, raffica di aperture, chiudi scheda dalla barra.

import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, premi } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

function nelVuoto(app, eventi) {
  return app.evaluate(({ BrowserWindow }, ev) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const wc = w._filoTabs.barra.vista.webContents;
    for (const e of ev) wc.sendInputEvent(e);
  }, eventi);
}

test('cambio di scheda a barra aperta: indietro segue la scheda davanti', async ({ app, shell, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><title>A</title><body><h1>A</h1></body>');
  const b = testServer.html('<!doctype html><title>B</title><body><h1>B</h1></body>');
  const page = await openTab(a);
  await page.evaluate((u) => { location.href = u; }, b);
  await page.waitForURL(b);
  const barra = await barraPage(app);
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  const back = barra.locator('#nav .ico[data-id="back"]');
  await expect(back).toHaveAttribute('aria-disabled', 'false');
  const ids = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return { tabs: w._filoTabs.tabs.map((t) => ({ id: t.id, url: t.url })), attiva: w._filoTabs.activeId };
  });
  const altra = ids.tabs.find((t) => t.id !== ids.attiva);
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), altra.id).catch(async () => {
    await app.evaluate(({ BrowserWindow }, id) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      w._filoTabs.activate(id);
    }, altra.id);
  });
  await pausa(600);
  const st = await statoBarra(app);
  console.log('dopo cambio scheda', JSON.stringify({ aperta: st.aperta, altra: altra.url }));
  await expect(back).toHaveAttribute('aria-disabled', 'true');
});

test('vuoto su pagina zoomata: il clic arriva al punto sotto il puntatore', async ({ app, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;height:2000px">
    <div style="position:fixed;left:0;top:0;width:400px;height:100%;background:#eee"></div>
    <script>window.clics=[];addEventListener('mousedown',e=>window.clics.push([e.clientX,e.clientY]));</script></body>`);
  const barra = await barraPage(app);
  for (const z of [1, 2]) {
    await app.evaluate(({ BrowserWindow }, zf) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
      t.view.webContents.setZoomFactor(zf);
    }, z);
    await pausa(300);
    await comandaBarra(app, 'tasto');
    await pannelloFermo(barra);
    const s = await statoBarra(app);
    const x = s.bounds.width - 4;
    await p.evaluate(() => { window.clics = []; });
    await nelVuoto(app, [{ type: 'mouseDown', x, y: 300, button: 'left', clickCount: 1 }, { type: 'mouseUp', x, y: 300, button: 'left', clickCount: 1 }]);
    await pausa(400);
    const c = await p.evaluate(() => window.clics);
    console.log('zoom', z, 'x vuoto', x, 'larghezza', s.bounds.width, 'clic pagina', JSON.stringify(c));
    expect(c.length).toBe(1);
    expect(Math.abs(c[0][0] - x / z)).toBeLessThanOrEqual(2);
    await comandaBarra(app, 'chiudi');
  }
});

test('Ctrl+Shift+B mentre scrivo nella home: la barra si apre e nel campo non entra niente', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.locator('#input').click();
  await page.keyboard.type('ciao');
  await barraPage(app);
  await premi(app, 'scheda', 'B', ['control', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  expect(await page.locator('#input').inputValue()).toBe('ciao');
  await premi(app, 'barra', 'B', ['control', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
  // La tastiera torna al campo: si continua a scrivere.
  await pausa(300);
  await premi(app, 'scheda', 'X', []);
  await pausa(300);
  console.log('campo dopo', await page.locator('#input').inputValue());
});

test('raffica di scorciatoie: lo stato finale è coerente con la vista', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<!doctype html><body><h1>x</h1></body>');
  const barra = await barraPage(app);
  for (let i = 0; i < 15; i++) await premi(app, i % 2 ? 'barra' : 'scheda', 'B', ['control', 'shift']).catch(() => {});
  await pausa(1200);
  const s = await statoBarra(app);
  const dom = await barra.evaluate(() => document.documentElement.classList.contains('aperta'));
  console.log('raffica', JSON.stringify({ aperta: s.aperta, dom, w: s.bounds.width }));
  expect(dom).toBe(s.aperta);
  expect(s.aperta ? s.bounds.width > 56 : s.bounds.width === s.chiusa).toBe(true);
});

test('chiudi scheda dalla barra', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<!doctype html><title>uno</title><body><h1>1</h1></body>');
  await testServer.openReady(openTab, '<!doctype html><title>due</title><body><h1>2</h1></body>');
  const barra = await barraPage(app);
  const prima = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.tabs.length);
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="closeTab"]').click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.tabs.length)).toBe(prima - 1);
  const s = await statoBarra(app);
  console.log('dopo chiudi', JSON.stringify({ aperta: s.aperta, w: s.bounds && s.bounds.width }));
});
