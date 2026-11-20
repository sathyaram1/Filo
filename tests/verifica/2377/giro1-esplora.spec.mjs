// Esplorazione della verifica #2377 giro 1: strade e casi oltre lo spec del lavoro.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Sito</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif"><h1>Una pagina</h1><p id="p">Primo pezzo. Secondo pezzo della pagina.</p><script>
    window.__tasti = [];
    window.addEventListener('keydown', (e) => { if (e.key && e.key.length === 1) window.__tasti.push(e.key); }, true);
    window.__letto = '';
    document.addEventListener('filo:read-aloud', (e) => { window.__letto = e.detail && e.detail.text; });
  </script></body></html>`;

// dove: 'scheda' | 'shell' | 'box'
function premi(app, passi, dove = 'scheda') {
  return app.evaluate(async ({ BrowserWindow }, { passi, dove }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const box = BrowserWindow.getAllWindows().find((x) => x.webContents.getTitle() === 'Lettere di Filo');
    const wc = dove === 'box' ? box.webContents : dove === 'shell' ? w.webContents : w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents;
    for (const p of passi) {
      if (p === 'tocco') {
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] });
        await new Promise((r) => setTimeout(r, 40));
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Control' });
        continue;
      }
      const [tipo, k, mod] = p;
      if (tipo === 'attendi') { await new Promise((r) => setTimeout(r, k)); continue; }
      wc.sendInputEvent({ type: tipo === 'giu' ? 'keyDown' : 'keyUp', keyCode: k, modifiers: mod || [] });
    }
  }, { passi, dove });
}
const lettera = (l, mod) => [['giu', l, mod], ['su', l, mod]];
const doppio = (l, dove) => ['tocco', ['attendi', 80], 'tocco', ['attendi', 60], ...lettera(l), ['attendi', 300]];
const boxVisibile = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .some((x) => x.webContents.getTitle() === 'Lettere di Filo' && x.isVisible()));
async function boxPagina(app) {
  for (const w of app.windows()) { try { if (await w.title() === 'Lettere di Filo') return w; } catch (_) {} }
  return null;
}
const temaScuro = (app) => app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
const spiaToast = (app) => app.evaluate(({ BrowserWindow }) => {
  globalThis.__toast = [];
  for (const w of BrowserWindow.getAllWindows().filter((x) => x._filoTabs)) {
    const s = w.webContents.send.bind(w.webContents);
    w.webContents.send = (c, ...a) => { if (c === 'shell:toast') globalThis.__toast.push(a[0] && a[0].text); return s(c, ...a); };
  }
});
const toast = (app) => app.evaluate(() => globalThis.__toast);
const davanti = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).url;
});

test('uso recente: la lettera appena usata sta in cima al box', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await testServer.openReady(openTab, PAGINA);
  const prima = await temaScuro(app);
  await premi(app, doppio('d'));
  await expect.poll(() => temaScuro(app)).toBe(!prima);
  await premi(app, ['tocco', ['attendi', 80], 'tocco']);
  await expect.poll(() => boxVisibile(app), { timeout: 5000 }).toBe(true);
  const box = await boxPagina(app);
  const prima1 = await box.evaluate(() => document.querySelector('.riga').dataset.lettera);
  console.log('PRIMA RIGA', prima1);
  expect(prima1).toBe('d');
  // Una lettera senza azione lascia il box aperto.
  await box.keyboard.press('r');
  await box.waitForTimeout(400);
  expect(await boxVisibile(app)).toBe(true);
  // Un clic su una riga fa l'azione.
  await box.locator('.riga[data-lettera="d"]').click();
  await expect.poll(() => boxVisibile(app)).toBe(false);
  await expect.poll(() => temaScuro(app)).toBe(prima);
});

test('dalla barra dell\'indirizzo il gesto vale lo stesso', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await testServer.openReady(openTab, PAGINA);
  const prima = await temaScuro(app);
  await premi(app, doppio('d'), 'shell');
  await expect.poll(() => temaScuro(app), { timeout: 5000 }).toBe(!prima);
});

test('I da un sito apre il menu Impostazioni; P senza niente che suona avvisa; F entra ed esce dallo schermo intero; H apre l\'Aiuto', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await testServer.openReady(openTab, PAGINA);
  await spiaToast(app);
  await premi(app, doppio('i'));
  let menu = false;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try { if (w.url().startsWith('data:text/html') && (await w.locator('button.item').allTextContents()).includes('Preferenze')) { menu = true; return true; } } catch (_) {}
    }
    return false;
  }, { timeout: 8000 }).toBe(true).catch(() => {});
  console.log('MENU DA SITO', menu);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).focus(); });
  await premi(app, doppio('p'));
  await new Promise((r) => setTimeout(r, 1500));
  console.log('TOAST P', JSON.stringify(await toast(app)));
  const fs = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito); return { win: w.isFullScreen(), html: !!w._filoTabs.contentFullscreen }; });
  console.log('FS prima', JSON.stringify(await fs()));
  await premi(app, doppio('f'));
  await new Promise((r) => setTimeout(r, 1500));
  console.log('FS dopo F', JSON.stringify(await fs()));
  await premi(app, doppio('f'));
  await new Promise((r) => setTimeout(r, 1500));
  console.log('FS dopo F F', JSON.stringify(await fs()));
  await premi(app, doppio('h'));
  await new Promise((r) => setTimeout(r, 2000));
  const aiuto = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito); const tm = w._filoTabs; return Object.keys(tm).filter((k) => /help|aiuto|sidebar|pannell/i.test(k)).map((k) => [k, typeof tm[k] === 'object' && tm[k] ? Object.keys(tm[k]).slice(0, 5) : tm[k]]); });
  console.log('AIUTO', JSON.stringify(aiuto).slice(0, 600));
});

test('L legge solo la selezione quando c\'è', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => { const r = document.createRange(); const t = document.getElementById('p').firstChild; r.setStart(t, 0); r.setEnd(t, 12); getSelection().removeAllRanges(); getSelection().addRange(r); });
  await premi(app, doppio('l'));
  await expect.poll(() => page.evaluate(() => window.__letto), { timeout: 8000 }).not.toBe('');
  const letto = await page.evaluate(() => window.__letto);
  console.log('LETTO', JSON.stringify(letto));
  expect(letto).not.toContain('Secondo pezzo');
});

test('A sulla home e sulla pagina; Alt+S sulla home', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await spiaToast(app);
  const home = await openTab('filo://newtab/');
  await home.waitForTimeout(1500);
  const n0 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.tabs.length);
  await premi(app, doppio('a'));
  await new Promise((r) => setTimeout(r, 1500));
  const n1 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.tabs.length);
  console.log('A HOME', n0, n1, JSON.stringify(await toast(app)), await davanti(app), 'box', await boxVisibile(app));
  await premi(app, [['giu', 'S', ['alt']], ['su', 'S', ['alt']], ['attendi', 1500]]);
  console.log('ALT+S HOME', JSON.stringify(await toast(app)), await davanti(app));
});

test('Z due volte riapre le due ultime schede chiuse, dalla più recente', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const a = await testServer.openReady(openTab, '<!doctype html><title>A</title><p>a</p>');
  const ua = a.url();
  const b = await testServer.openReady(openTab, '<!doctype html><title>B</title><p>b</p>');
  const ub = b.url();
  const chiudi = () => app.evaluate(({ BrowserWindow }) => { const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs; tm.closeTab(tm.activeId); });
  await chiudi();
  await new Promise((r) => setTimeout(r, 500));
  await chiudi();
  await new Promise((r) => setTimeout(r, 800));
  const urls = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.tabs.map((t) => t.url));
  await premi(app, doppio('z'));
  await expect.poll(async () => (await urls()).includes(ua), { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 800));
  await premi(app, doppio('z'));
  await expect.poll(async () => (await urls()).includes(ub), { timeout: 8000 }).toBe(true);
});

test('incognito: il box compare sopra la finestra in incognito', async ({ app }) => {
  test.setTimeout(60_000);
  const ok = await app.evaluate(async ({ BrowserWindow }) => {
    const rq = process.mainModule.require;
    const W = rq(rq('node:path').join(process.cwd(), 'src/main/window.js'));
    return Object.keys(W);
  });
  console.log('WINDOW API', JSON.stringify(ok));
});
