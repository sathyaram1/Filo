// Verifica #1343 giro 7: esplorazione (si cancella prima della critica).

import { test, expect } from '../../fixtures/electron.mjs';
import { iconaDellaBarra, barraPage, statoBarra, comandaBarra, pannelloFermo, premi } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SITO = '<!doctype html><html><head><title>Prima</title></head><body style="height:1400px"><h1>Prima</h1><p>Testo della pagina.</p></body></html>';
const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const naviga = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.navigate(w._filoTabs.activeId, url);
}, u);
const statiPagina = async (app) => {
  const barra = await barraPage(app);
  return barra.evaluate(() => [...document.querySelectorAll('#nav .ico')].map((b) => `${b.dataset.id}:${b.getAttribute('aria-disabled')}:${b.dataset.sugg || ''}`));
};

test('E1 pagine di Filo: stato delle azioni sulla pagina', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  for (const u of ['filo://newtab/', 'filo://history/history.html', 'filo://preferences/preferences.html']) {
    await naviga(app, u);
    await pausa(2500);
    await iconaDellaBarra(app, 'share');
    console.log('STATI', u, JSON.stringify(await statiPagina(app)));
    await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
    const share = await iconaDellaBarra(app, 'share');
    if ((await share.getAttribute('aria-disabled')) !== 'true') {
      await share.click();
      await pausa(1500);
      console.log('APPUNTI', u, await appunti(app));
    }
    await comandaBarra(app, 'chiudi');
    await pausa(400);
  }
});

test('E2 barra in tema chiaro e scuro, e menu del tasto destro', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.screenshot({ path: 'tests/.shots/g7-barra-chiara.png' });
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { theme: 'dark' } }, { url: 'filo://preferences/preferences.html' }));
  await pausa(1200);
  await barra.screenshot({ path: 'tests/.shots/g7-barra-scura.png' });
  await page.screenshot({ path: 'tests/.shots/g7-pagina-scura.png' });
  const sh = app.windows().find((w) => w.url().startsWith('filo://shell/shell'));
  if (sh) await sh.screenshot({ path: 'tests/.shots/g7-shell-scura.png' });
  console.log('TEMA', JSON.stringify(await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.barra; return b.tema; })));
  await comandaBarra(app, 'chiudi');
  await pausa(500);
  await page.mouse.click(300, 200, { button: 'right' });
  await pausa(1200);
  await page.screenshot({ path: 'tests/.shots/g7-menu-scuro.png' });
});

test('E3 da tastiera: Ctrl+Shift+B, frecce fino a Condividi, Invio', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const url = page.url();
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  await premi(app, 'pagina', 'B', ['control', 'shift']);
  const barra = await barraPage(app);
  await pausa(800);
  const s = await statoBarra(app);
  console.log('APERTA', JSON.stringify({ aperta: s.aperta, motivo: s.motivo, bar: s.bar }));
  const ids = s.bar;
  const quante = ids.indexOf('share');
  const attivo = await barra.evaluate(() => document.activeElement && (document.activeElement.dataset.id || document.activeElement.id || document.activeElement.className));
  console.log('FUOCO', attivo);
  for (let i = 0; i < quante + 3; i++) {
    const a = await barra.evaluate(() => document.activeElement && document.activeElement.dataset.id);
    if (a === 'share') break;
    await premi(app, 'barra', 'Down');
    await pausa(80);
  }
  console.log('FUOCO2', await barra.evaluate(() => document.activeElement && document.activeElement.dataset.id));
  await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.barra.vista.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    wc.sendInputEvent({ type: 'char', keyCode: 'Return' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  });
  await pausa(2000);
  console.log('APPUNTI', await appunti(app), 'voluto', url);
});

test('E4 schermo intero: angolo in alto a sinistra', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const page = await testServer.openReady(openTab, SITO.replace('Prima', 'Seconda'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.setContentFullscreen(true));
  await pausa(800);
  await page.mouse.move(300, 200);
  await page.mouse.move(1, 0, { steps: 4 });
  await pausa(1200);
  const s = await statoBarra(app);
  const y = await app.evaluate(({ BrowserWindow }) => { const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs; return tm.tabs.find((t) => t.id === tm.activeId).view.getBounds(); });
  console.log('ANGOLO', JSON.stringify({ barra: s.aperta, bounds: s.bounds, vista: y }));
  await page.screenshot({ path: 'tests/.shots/g7-angolo.png' });
  await shell.screenshot({ path: 'tests/.shots/g7-angolo-shell.png' });
});

test('E5 schermo intero: linguetta della barra cliccata dalla fila, poi giù nella barra', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const page = await testServer.openReady(openTab, SITO.replace('Prima', 'Seconda'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.setContentFullscreen(true));
  await pausa(800);
  await page.mouse.move(300, 200);
  await page.mouse.move(300, 0, { steps: 4 });
  await pausa(800);
  const m = shell.locator('#barra-maniglia');
  const box = await m.boundingBox();
  await shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await m.click();
  await pausa(600);
  const barra = await barraPage(app);
  const s1 = await statoBarra(app);
  console.log('DOPO CLIC', JSON.stringify({ aperta: s1.aperta, bounds: s1.bounds, alto: s1.alto }));
  await barra.screenshot({ path: 'tests/.shots/g7-e5-a.png' });
  // il puntatore scende nella barra, sulla quinta icona
  await app.evaluate(({ BrowserWindow }, p) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.webContents.sendInputEvent({ type: 'mouseLeave', x: p.x, y: p.y });
  }, { x: Math.round(box.x + box.width / 2), y: 45 });
  const ico = barra.locator('#nav .ico[data-id="home"]');
  const ib = await ico.boundingBox();
  await barra.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2, { steps: 3 });
  await pausa(1500);
  const s2 = await statoBarra(app);
  const dy = (s1.bounds.y - s2.bounds.y);
  const sotto = await barra.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); const b = e && e.closest('.ico'); return b ? b.dataset.id : (e && e.id); }, [ib.x + ib.width / 2, ib.y + ib.height / 2 + dy]);
  console.log('DOPO DISCESA', JSON.stringify({ aperta: s2.aperta, bounds: s2.bounds, alto: s2.alto, primaY: s1.bounds && s1.bounds.y }), 'icona allo stesso punto dello schermo:', sotto);
});

test('E6 schermo intero: riquadro di un altro sito a metà pagina, puntatore fermo sul suo bordo alto', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body style="margin:0;background:#cde;height:100vh">Video incorporato</body></html>', { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Articolo</title></head><body style="margin:0;font:16px sans-serif">
    <div style="height:300px;padding:20px">Testo dell'articolo</div>
    <iframe src="${dentro}" style="display:block;width:600px;height:300px;border:0;margin-left:100px"></iframe><div style="height:900px"></div></body></html>`);
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.setContentFullscreen(true));
  await pausa(800);
  const fr = await page.locator('iframe').boundingBox();
  console.log('IFRAME', JSON.stringify(fr));
  await page.mouse.move(400, fr.y + 100);
  await page.mouse.move(400, fr.y + 1, { steps: 4 });
  await pausa(1200);
  const v = await app.evaluate(({ BrowserWindow }) => { const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs; return tm.tabs.find((t) => t.id === tm.activeId).view.getBounds().y; });
  console.log('SCHEDE A META PAGINA', v);
  await page.mouse.move(400, fr.y + 150, { steps: 3 });
  await page.mouse.wheel(0, 200);
  await pausa(300);
  const fr2 = await page.locator('iframe').boundingBox();
  await page.mouse.move(400, fr2.y + 1, { steps: 4 });
  await pausa(1200);
  const v2 = await app.evaluate(({ BrowserWindow }) => { const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs; return tm.tabs.find((t) => t.id === tm.activeId).view.getBounds().y; });
  console.log('SCHEDE DOPO SCROLL', JSON.stringify(fr2), v2);
});
