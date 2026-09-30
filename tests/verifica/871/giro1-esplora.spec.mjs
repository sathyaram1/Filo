// #871 verifica giro 1 — esplorazione: schede, finestra, tastiera, azioni di pagina dalla barra.

import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, premi, mettiNelMenu } from '../../helpers/barra.mjs';
import { captureComposite } from '../../agent/driver.mjs';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots', 'v871');
mkdirSync(OUT, { recursive: true });
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const SITO = (t) => `<!doctype html><html><head><title>${t}</title></head><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px;background:#fff">
  <h1>${t}</h1><p id="p">Testo.</p><a id="anc" href="#giu">giu</a> <a id="push" href="javascript:void 0" onclick="history.pushState({}, '', '/spa-' + Date.now())">spa</a>
  <input id="campo" placeholder="scrivi"><div id="giu" style="margin-top:900px">giu</div>
</body></html>`;

async function disabled(barra, id) {
  return barra.locator(`#nav .ico[data-id="${id}"]`).getAttribute('aria-disabled');
}

test('cambio scheda: indietro e avanti seguono la scheda davanti', async ({ app, shell, openTab, testServer }) => {
  const a = await testServer.openReady(openTab, SITO('A'));
  const barra = await barraPage(app);
  await a.goto(testServer.html(SITO('A2')));
  await a.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await expect.poll(() => disabled(barra, 'back')).toBe('false');
  const idA = await shell.evaluate(() => window.filoShell && true);
  const b = await testServer.openReady(openTab, SITO('B'));
  await expect.poll(() => disabled(barra, 'back')).toBe('true');
  // torna alla scheda A dalla fila
  const ids = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.tabs.map((t) => ({ id: t.id, url: t.url }));
  });
  const tabA = ids.find((t) => /A2|\/2$/.test(t.url) || t.url.endsWith('/2'));
  await app.evaluate(({ BrowserWindow }, id) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.activate ? w._filoTabs.activate(id) : w._filoTabs.switchTo(id);
  }, tabA.id);
  await expect.poll(() => disabled(barra, 'back')).toBe('false');
});

test('navigazione dentro la pagina (ancora e pushState) accende indietro', async ({ app, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, SITO('SPA'));
  const barra = await barraPage(app);
  await expect.poll(() => disabled(barra, 'back')).toBe('true');
  await p.click('#push');
  await expect.poll(() => disabled(barra, 'back')).toBe('false');
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="back"]').click();
  await expect.poll(() => p.url()).not.toContain('spa-');
  await expect.poll(() => disabled(barra, 'back')).toBe('true');
  await expect.poll(() => disabled(barra, 'forward')).toBe('false');
});

test('finestra ridimensionata: la barra segue l\'altezza', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO('R'));
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.setSize(900, 500);
  });
  await pausa(600);
  const s = await statoBarra(app);
  const H = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w.getContentSize()[1];
  });
  console.log('RESIZE', JSON.stringify(s.bounds), H, s.alto);
  expect(s.bounds.y + s.bounds.height).toBe(H);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.setSize(1300, 900);
  });
  await pausa(600);
  const s2 = await statoBarra(app);
  const H2 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).getContentSize()[1]);
  console.log('RESIZE2', JSON.stringify(s2.bounds), H2);
  expect(s2.bounds.y + s2.bounds.height).toBe(H2);
});

test('da tastiera: apri, frecce, Invio su ricarica, Esc e si riscrive nella pagina', async ({ app, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, SITO('K'));
  const barra = await barraPage(app);
  await p.click('#campo');
  await p.keyboard.type('ab');
  await premi(app, 'scheda', 'B', ['control', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pausa(300);
  const attivo = await barra.evaluate(() => document.activeElement && (document.activeElement.dataset.id || document.activeElement.dataset.comando || document.activeElement.tagName));
  console.log('FOCUS', attivo);
  await premi(app, 'barra', 'Escape');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
  await pausa(400);
  const fuoco = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return { scheda: t.view.webContents.isFocused(), barra: w._filoTabs.barra.vista.webContents.isFocused() };
  });
  console.log('FUOCO', JSON.stringify(fuoco), await p.evaluate(() => document.activeElement && document.activeElement.id));
  expect(fuoco.scheda).toBe(true);
});

test('scorciatoia dalla home di Filo col fuoco nel campo della chat', async ({ app, shell }) => {
  await pausa(1500);
  console.log('WINS', app.windows().map((w) => w.url()).join(' '));
  const home = app.windows().find((w) => { try { return /newtab|dashboard/.test(w.url()); } catch (_) { return false; } });
  expect(home).toBeTruthy();
  await home.waitForLoadState('domcontentloaded');
  const barra = await barraPage(app);
  const input = home.locator('textarea, input[type="text"]').first();
  await input.click().catch(() => {});
  await premi(app, 'scheda', 'B', ['control', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await premi(app, 'barra', 'B', ['control', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
  // dalla fila delle schede
  await shell.evaluate(() => document.body.focus());
  await premi(app, 'shell', 'B', ['control', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
});

test('screenshot e QR portati nella barra funzionano su un sito e sulla home', async ({ app, shell, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, SITO('Q'));
  const barra = await barraPage(app);
  const r = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: 'qrCode', target: 'bar' }, {}));
  expect(r.ok).toBe(true);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await expect(barra.locator('#nav .ico[data-id="qrCode"]')).toBeVisible();
  await barra.locator('#nav .ico[data-id="qrCode"]').click();
  await pausa(1200);
  await expect(p.locator('.sn-qr-overlay')).toHaveCount(1);
  await p.keyboard.press('Escape');
  // sulla home
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await pausa(2000);
  const home = app.windows().filter((w) => { try { return /newtab|dashboard/.test(w.url()); } catch (_) { return false; } }).pop();
  console.log('HOME', home && home.url());
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="qrCode"]').click();
  await pausa(1200);
  console.log('QR HOME', await home.locator('.sn-qr-overlay').count());
  await expect(home.locator('.sn-qr-overlay')).toHaveCount(1);
});

test('schermate: chiusa, aperta, scura, home, menu App', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const tag = process.env.FILO_TEST_SCALE ? `-s${process.env.FILO_TEST_SCALE}` : '';
  const p = await testServer.openReady(openTab, SITO('Una pagina qualunque'));
  const barra = await barraPage(app);
  await pausa(800);
  await captureComposite(app, resolve(OUT, `chiusa${tag}.png`));
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="reload"]').hover();
  await pausa(900);
  await captureComposite(app, resolve(OUT, `aperta${tag}.png`));
  await barra.locator('#fisse .ico[data-comando="apps"]').click();
  await pausa(900);
  await captureComposite(app, resolve(OUT, `menu-app${tag}.png`));
  await p.mouse.click(600, 400);
  await pausa(600);
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await shell.emulateMedia({ colorScheme: 'dark' });
  await barra.emulateMedia({ colorScheme: 'dark' });
  await p.emulateMedia({ colorScheme: 'dark' });
  await pausa(1200);
  await captureComposite(app, resolve(OUT, `chiusa-scura${tag}.png`));
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await pausa(400);
  await captureComposite(app, resolve(OUT, `aperta-scura${tag}.png`));
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await pausa(2500);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await pausa(400);
  await captureComposite(app, resolve(OUT, `home-scura${tag}.png`));
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'light' } }));
  await shell.emulateMedia({ colorScheme: 'light' });
  await barra.emulateMedia({ colorScheme: 'light' });
  await pausa(1200);
  await captureComposite(app, resolve(OUT, `home-chiara${tag}.png`));
  await comandaBarra(app, 'chiudi');
  await pausa(800);
  await captureComposite(app, resolve(OUT, `home-chiara-chiusa${tag}.png`));
});

test('App, Impostazioni e Profilo dalla barra aprono il loro menu accanto alla barra', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO('M'));
  const barra = await barraPage(app);
  for (const comando of ['apps', 'settings', 'account']) {
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra);
    await barra.locator(`#fisse .ico[data-comando="${comando}"]`).click();
    await pausa(1200);
    const finestre = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ vis: w.isVisible(), b: w.getBounds(), url: w.webContents.getURL().slice(0, 60), main: !!w._filoTabs })));
    console.log(comando, JSON.stringify(finestre));
    const s = await statoBarra(app);
    console.log(comando, 'barra aperta', s.aperta);
    await captureComposite(app, resolve(OUT, `menu-${comando}.png`));
    // chiudi il menu
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (!w._filoTabs && w.isVisible()) w.close(); });
    await pausa(300);
  }
});

test('tema scuro: shell e barra', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO('T'));
  const barra = await barraPage(app);
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await pausa(1500);
  const sh = await shell.evaluate(() => ({ mm: matchMedia('(prefers-color-scheme: dark)').matches, bg: getComputedStyle(document.documentElement).getPropertyValue('--bg'), inline: document.documentElement.getAttribute('style') }));
  const ba = await barra.evaluate(() => ({ mm: matchMedia('(prefers-color-scheme: dark)').matches, bg: getComputedStyle(document.documentElement).getPropertyValue('--bg'), inline: document.documentElement.getAttribute('style') }));
  const ts = await app.evaluate(({ nativeTheme }) => ({ src: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors }));
  console.log('SHELL', JSON.stringify(sh));
  console.log('BARRA', JSON.stringify(ba));
  console.log('NATIVE', JSON.stringify(ts));
});

test('schermo intero chiesto dal sito (video): la barra resta raggiungibile, Esc esce', async ({ app, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0"><div id="v" style="background:#333;width:100%;height:100%;color:#fff">video</div>
    <button id="fs" onclick="document.getElementById('v').requestFullscreen()">fs</button></body></html>`);
  const barra = await barraPage(app);
  await p.click('#fs');
  await expect.poll(() => p.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await pausa(800);
  const s = await statoBarra(app);
  const tb = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    const figli = w.contentView.children;
    return { tab: t.view.getBounds(), sopra: figli.indexOf(w._filoTabs.barra.vista) > figli.indexOf(t.view), vis: w._filoTabs.barra.vista.getVisible ? w._filoTabs.barra.vista.getVisible() : null, fs: w.isFullScreen() };
  });
  console.log('FS', JSON.stringify(s), JSON.stringify(tb));
  expect(s.bounds.y).toBeLessThanOrEqual(tb.tab.y);
  expect(tb.sopra).toBe(true);
  await barra.mouse.move(0, 300);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  // il mouse torna sulla pagina: la barra si chiude
  await p.mouse.move(600, 300);
  await p.mouse.move(610, 310);
  await expect.poll(async () => (await statoBarra(app)).aperta, { timeout: 3000 }).toBe(false);
  await premi(app, 'scheda', 'Escape');
  await expect.poll(() => p.evaluate(() => !!document.fullscreenElement)).toBe(false);
});

test('stress: la scorciatoia premuta di fila e la striscia cliccata mentre si chiude', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO('S'));
  const barra = await barraPage(app);
  for (let i = 0; i < 9; i++) { await premi(app, 'scheda', 'B', ['control', 'shift']); await pausa(30); }
  await pausa(600);
  let s = await statoBarra(app);
  console.log('DISPARI', s.aperta, JSON.stringify(s.bounds));
  expect(s.aperta).toBe(true);
  expect(s.bounds.width).toBeGreaterThan(56);
  await premi(app, 'barra', 'B', ['control', 'shift']);
  await pausa(600);
  s = await statoBarra(app);
  expect(s.aperta).toBe(false);
  expect(s.bounds.width).toBe(4);
  const vis = await barra.evaluate(() => getComputedStyle(document.getElementById('pannello')).visibility + '/' + getComputedStyle(document.getElementById('pannello')).transform);
  console.log('PANNELLO CHIUSO', vis);
});

for (const zoom of [1.5, 0.67]) {
  test(`pagina zoomata ${zoom}: trascinare Screenshot dal menu fra ricarica e home`, async ({ app, openTab, testServer }) => {
    const p = await testServer.openReady(openTab, SITO('Z'));
    const barra = await barraPage(app);
    await app.evaluate(({ BrowserWindow }, z) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
      t.view.webContents.setZoomFactor(z);
    }, zoom);
    await pausa(500);
    await p.locator('#p').click({ button: 'right' });
    const icona = p.locator('.sn-menu [data-sn-icon-id="screenshot"]').first();
    await expect(icona).toBeVisible();
    const box = await icona.boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.mouse.move(box.x + 12, box.y + 12, { steps: 3 });
    await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
    await pannelloFermo(barra);
    const home = await barra.locator('#nav .ico[data-id="home"]').boundingBox();
    const s = await statoBarra(app);
    const tb = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      return w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId).view.getBounds();
    });
    // punto della barra (px della vista) → px della pagina
    const yPagina = (s.bounds.y + home.y + 4 - tb.y) / zoom;
    const xPagina = 30 / zoom;
    await p.mouse.move(xPagina, yPagina, { steps: 8 });
    await expect(barra.locator('#nav')).toHaveClass(/mira/);
    await p.mouse.up();
    await expect.poll(async () => (await statoBarra(app)).bar).toEqual(['back', 'forward', 'reload', 'screenshot', 'home', 'incognito', 'fullscreen', 'closeTab']);
  });
}

test('il margine trasparente della barra aperta è della pagina: clic e rotella arrivano al sito', async ({ app, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:3000px">
    <div id="z" style="position:fixed;left:0;top:0;width:200px;height:100%;background:#eee"></div>
    <script>window.clic=0;document.getElementById('z').addEventListener('click',()=>window.clic++);</script></body></html>`);
  const barra = await barraPage(app);
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  const s = await statoBarra(app);
  console.log('BOUNDS', JSON.stringify(s.bounds));
  // clic nel margine dell'ombra (x = 64 nella vista)
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const wc = w._filoTabs.barra.vista.webContents;
    wc.sendInputEvent({ type: 'mouseMove', x: 64, y: 300 });
    wc.sendInputEvent({ type: 'mouseDown', x: 64, y: 300, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: 64, y: 300, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseWheel', x: 64, y: 300, deltaX: 0, deltaY: -400 });
  });
  await pausa(800);
  const r = await p.evaluate(() => ({ clic: window.clic, y: window.scrollY }));
  console.log('MARGINE', JSON.stringify(r), 'aperta', (await statoBarra(app)).aperta);
  expect(r.clic).toBe(1);
});

import { execFileSync } from 'node:child_process';
const XM = '/tmp/claude-0/-home-user-Filo/c6afb1e3-5e7a-5326-9a17-ad494d857200/scratchpad/xmouse.py';
const xm = (seq) => execFileSync('python3', [XM, seq], { env: process.env, encoding: 'utf8' });

test('mouse vero (XTest): spinta, clic sulla striscia, di corsa, scheda trascinata, finestra non massimizzata', async ({ app, shell, openTab, testServer }) => {
  test.skip(process.env.FILO_TEST_VISIBLE !== '1', 'serve la finestra a schermo');
  test.setTimeout(90_000);
  await testServer.openReady(openTab, SITO('X'));
  await barraPage(app);
  const info = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return { cb: w.getContentBounds(), max: w.isMaximized(), res: w.isResizable() };
  });
  console.log('WIN', JSON.stringify(info));
  const { cb } = info;
  const ap = async () => (await statoBarra(app)).aperta;
  // 1. di corsa
  xm(`move:${cb.x + 400}:${cb.y + 300};wait:200;move:${cb.x + 1}:${cb.y + 300};wait:60;move:${cb.x + 300}:${cb.y + 300};wait:600`);
  console.log('DI CORSA aperta', await ap());
  // 2. spinta: fermo sul bordo
  xm(`move:${cb.x + 1}:${cb.y + 300};wait:40;move:${cb.x + 0}:${cb.y + 302};wait:700`);
  console.log('SPINTA x+0/1 aperta', await ap());
  xm(`move:${cb.x + 600}:${cb.y + 300};wait:900`);
  console.log('dopo uscita aperta', await ap());
  xm(`move:${cb.x + 3}:${cb.y + 300};wait:40;move:${cb.x + 2}:${cb.y + 305};wait:700`);
  console.log('SPINTA x+2/3 aperta', await ap());
  xm(`move:${cb.x + 600}:${cb.y + 300};wait:900`);
  // 3. clic sulla striscia
  xm(`move:${cb.x + 2}:${cb.y + 400};down;wait:30;up;wait:400`);
  console.log('CLIC STRISCIA aperta', await ap(), JSON.stringify(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).getContentBounds())));
  xm(`move:${cb.x + 600}:${cb.y + 300};wait:900`);
  console.log('dopo uscita aperta', await ap());
  // 4. scheda trascinata dalla fila fino al bordo
  const tabBox = await shell.locator('.tab').last().boundingBox();
  xm(`move:${cb.x + tabBox.x + 30}:${cb.y + tabBox.y + 10};wait:100;down;wait:100;move:${cb.x + tabBox.x + 10}:${cb.y + tabBox.y + 60};wait:50;move:${cb.x + 1}:${cb.y + 300};wait:50;move:${cb.x + 0}:${cb.y + 310};wait:800`);
  console.log('SCHEDA TRASCINATA aperta (col tasto giù)', await ap());
  xm(`up;wait:300`);
  console.log('dopo rilascio', await ap());
});

test('mouse vero (XTest): controllo, gli eventi arrivano; maniglia; bordo sinistro della striscia', async ({ app, shell, openTab, testServer }) => {
  test.skip(process.env.FILO_TEST_VISIBLE !== '1', 'serve la finestra a schermo');
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, SITO('C'));
  const barra = await barraPage(app);
  await p.evaluate(() => { window.mosse = []; addEventListener('mousemove', (e) => window.mosse.push(e.clientX)); });
  await barra.evaluate(() => { window.mosse = []; addEventListener('pointermove', (e) => window.mosse.push(e.clientX)); });
  const { cb } = await app.evaluate(({ BrowserWindow }) => ({ cb: BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).getContentBounds() }));
  const ap = async () => (await statoBarra(app)).aperta;
  for (const dx of [40, 12, 8, 6, 5, 4, 3, 2, 1, 0]) {
    xm(`move:${cb.x + dx}:${cb.y + 300};wait:120`);
  }
  xm('wait:500');
  console.log('PAGINA mosse', JSON.stringify(await p.evaluate(() => window.mosse)));
  console.log('BARRA mosse', JSON.stringify(await barra.evaluate(() => window.mosse)));
  console.log('aperta', await ap());
  xm(`move:${cb.x + 600}:${cb.y + 300};wait:900`);
  const m = await shell.locator('#barra-maniglia').boundingBox();
  xm(`move:${cb.x + m.x + m.width / 2}:${cb.y + m.y + m.height / 2};wait:100;down;wait:30;up;wait:500`);
  console.log('MANIGLIA aperta', await ap());
  // barra aperta: mouse vero sul pannello e poi nel margine
  await pannelloFermo(barra).catch(() => {});
  xm(`move:${cb.x + 28}:${cb.y + 200};wait:300`);
  console.log('dentro pannello aperta', await ap());
});

test('mouse vero (XTest): finestra massimizzata, spinta e clic sulla striscia', async ({ app, openTab, testServer }) => {
  test.skip(process.env.FILO_TEST_VISIBLE !== '1', 'serve la finestra a schermo');
  test.setTimeout(90_000);
  await testServer.openReady(openTab, SITO('MAX'));
  const barra = await barraPage(app);
  await barra.evaluate(() => { window.mosse = []; addEventListener('pointermove', (e) => window.mosse.push(e.clientX)); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).maximize());
  await pausa(1500);
  const info = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito); return { cb: w.getContentBounds(), max: w.isMaximized() }; });
  console.log('MAX', JSON.stringify(info));
  const { cb } = info;
  const ap = async () => (await statoBarra(app)).aperta;
  xm(`move:${cb.x + 300}:${cb.y + 300};wait:100;move:${cb.x + 1}:${cb.y + 300};wait:20;move:${cb.x}:${cb.y + 302};wait:700`);
  console.log('SPINTA max aperta', await ap(), JSON.stringify(await barra.evaluate(() => window.mosse)));
  xm(`move:${cb.x + 600}:${cb.y + 300};wait:900`);
  xm(`move:${cb.x + 2}:${cb.y + 400};down;wait:30;up;wait:400`);
  console.log('CLIC max aperta', await ap());
});

test('mouse vero (XTest): a schermo intero la spinta funziona (il bordo non è più di ridimensionamento)', async ({ app, openTab, testServer }) => {
  test.skip(process.env.FILO_TEST_VISIBLE !== '1', 'serve la finestra a schermo');
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0"><div id="v" style="background:#333;width:100%;height:100%;color:#fff">video</div>
    <button id="fs" onclick="document.getElementById('v').requestFullscreen()">fs</button></body></html>`);
  const barra = await barraPage(app);
  await p.click('#fs');
  await pausa(1500);
  const info = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito); return { cb: w.getContentBounds(), fs: w.isFullScreen() }; });
  console.log('FS', JSON.stringify(info));
  const { cb } = info;
  await p.evaluate(() => { window.mosse = []; addEventListener('mousemove', (e) => window.mosse.push(e.clientX)); });
  await barra.evaluate(() => { window.mosse = []; addEventListener('pointermove', (e) => window.mosse.push(e.clientX)); });
  for (const dx of [40, 12, 8, 6, 5, 4, 3, 2, 1, 0]) xm(`move:${cb.x + dx}:${cb.y + 300};wait:120`);
  xm('wait:600');
  console.log('FS pagina', JSON.stringify(await p.evaluate(() => window.mosse)), 'barra', JSON.stringify(await barra.evaluate(() => window.mosse)));
  console.log('SPINTA fs aperta', (await statoBarra(app)).aperta, JSON.stringify((await statoBarra(app)).bounds));
});

test('mouse vero (XTest): la vista della barra riceve il puntatore vero?', async ({ app, openTab, testServer }) => {
  test.skip(process.env.FILO_TEST_VISIBLE !== '1', 'serve la finestra a schermo');
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, SITO('R'));
  const barra = await barraPage(app);
  await p.evaluate(() => { window.mosse = []; addEventListener('mousemove', (e) => window.mosse.push(e.clientX)); });
  await barra.evaluate(() => { window.mosse = []; addEventListener('pointermove', (e) => window.mosse.push(e.clientX)); });
  const { cb } = await app.evaluate(({ BrowserWindow }) => ({ cb: BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).getContentBounds() }));
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  for (const dx of [200, 100, 80, 70, 60, 40, 28, 20, 10, 6]) xm(`move:${cb.x + dx}:${cb.y + 300};wait:120`);
  xm('wait:300');
  console.log('APERTA pagina', JSON.stringify(await p.evaluate(() => window.mosse)), 'barra', JSON.stringify(await barra.evaluate(() => window.mosse)));
  const hover = await barra.evaluate(() => [...document.querySelectorAll('.ico')].filter((b) => b.matches(':hover')).map((b) => b.dataset.id || b.dataset.comando));
  console.log('HOVER', JSON.stringify(hover));
  // clic vero su «ricarica»
  const r = await barra.locator('#nav .ico[data-id="reload"]').boundingBox();
  const s = await statoBarra(app);
  await p.evaluate(() => { window.__prima = 1; });
  xm(`move:${cb.x + s.bounds.x + r.x + r.width / 2}:${cb.y + s.bounds.y + r.y + r.height / 2};wait:200;down;wait:40;up;wait:1200`);
  let ricaricata = null;
  try { ricaricata = await p.evaluate(() => window.__prima === undefined); } catch (e) { ricaricata = 'err ' + e.message.slice(0, 80); }
  console.log('RICARICA con clic vero', ricaricata);
});
