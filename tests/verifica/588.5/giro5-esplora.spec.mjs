// Verifica #588.5 giro 5 — esplorazione col mouse e lo schermo veri (xdotool e scrot sullo schermo virtuale).
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SHOTS = resolve('tests/.shots');
mkdirSync(SHOTS, { recursive: true });
test.setTimeout(120000);
test.skip(!process.env.DISPLAY, 'serve lo schermo virtuale');

const xdo = (...a) => execFileSync('xdotool', a.map(String));
function scatta(nome) {
  const p = join(SHOTS, `588.5-g5-${nome}.png`);
  try { execFileSync('scrot', ['-o', p]); } catch (e) { console.log('scrot', e.message); }
  return p;
}

async function contenuto(app) {
  return app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const tm = win._filoTabs;
    const v = tm.avvisi.vista;
    const figli = win.contentView.children;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    return {
      s: screen.getPrimaryDisplay().scaleFactor,
      c: win.getContentBounds(),
      t: tab ? tab.view.getBounds() : null,
      vista: v ? v.getBounds() : null,
      inCima: !!v && figli[figli.length - 1] === v,
      schede: tm.tabs.length,
    };
  });
}
// Punto della vista (px CSS della vista) in coordinate dello schermo, in pixel fisici.
const schermo = (k, x, y) => [Math.round((k.c.x + k.vista.x + x) * k.s), Math.round((k.c.y + k.vista.y + y) * k.s)];
const pagina = (k, x, y) => [Math.round((k.c.x + k.t.x + x) * k.s), Math.round((k.c.y + k.t.y + y) * k.s)];

async function cartaRect(vista) {
  return vista.evaluate(() => { const r = document.querySelector('.shell-notif.show').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
}

test('tasti laterali del mouse nel vuoto accanto alla carta: la pagina non riceve un clic sinistro', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:100vh;background:#eee">
    <button id="b" style="position:fixed;left:0;top:0;width:100vw;height:100vh;opacity:.4">bersaglio</button>
    <script>window.__ev=[];for(const t of ['mousedown','mouseup','click','auxclick'])document.addEventListener(t,e=>__ev.push(t+':'+e.button),true);</script></body></html>`);
  // Controllo: tasto indietro nella pagina, lontano dalla carta.
  const k0 = await contenuto(app);
  xdo('mousemove', '--sync', ...pagina(k0, 100, 100));
  await page.waitForTimeout(200);
  xdo('click', 8);
  await page.waitForTimeout(500);
  const controllo = await page.evaluate(() => window.__ev.splice(0));
  console.log('controllo pagina, tasto 8:', JSON.stringify(controllo));

  await shell.evaluate(() => window.filoNotify('Scaricato: prova.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await page.waitForTimeout(600);
  const k = await contenuto(app);
  const c = await cartaRect(vista);
  console.log('posa', JSON.stringify(k), JSON.stringify(c));
  // Nel vuoto a sinistra della carta, a metà altezza.
  xdo('mousemove', '--sync', ...schermo(k, Math.max(2, c.x - 6), c.y + c.h / 2));
  await page.waitForTimeout(300);
  xdo('click', 8);
  await page.waitForTimeout(500);
  xdo('click', 9);
  await page.waitForTimeout(500);
  const vuoto = await page.evaluate(() => window.__ev.splice(0));
  console.log('nel vuoto, tasti 8 e 9:', JSON.stringify(vuoto));
  // Sopra la carta
  xdo('mousemove', '--sync', ...schermo(k, c.x + 20, c.y + 12));
  await page.waitForTimeout(300);
  xdo('click', 8);
  await page.waitForTimeout(500);
  console.log('sopra la carta, tasto 8:', JSON.stringify(await page.evaluate(() => window.__ev.splice(0))));
  expect(vuoto.filter((e) => e === 'click:0')).toEqual([]);
});

test('rotella vera nel vuoto e sopra la carta; clic centrale su un collegamento nel vuoto', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;background:#eee">
    <div style="height:5000px;position:relative"><a id="l" href="/altro" style="position:fixed;right:0;bottom:0;display:block;width:100vw;height:100vh;opacity:.3">collegamento</a></div></body></html>`);
  await shell.evaluate(() => window.filoNotify('Scaricato: prova.pdf', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await page.waitForTimeout(600);
  const k = await contenuto(app);
  const c = await cartaRect(vista);
  // Controllo: tre scatti nella pagina, lontano dalla carta.
  xdo('mousemove', '--sync', ...pagina(k, 200, 200));
  await page.waitForTimeout(200);
  xdo('click', '--repeat', 3, '--delay', 60, 5);
  await page.waitForTimeout(800);
  console.log('rotella: controllo nella pagina', await page.evaluate(() => scrollY));
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(300);
  xdo('mousemove', '--sync', ...schermo(k, Math.max(2, c.x - 6), c.y + c.h / 2));
  await page.waitForTimeout(200);
  xdo('click', '--repeat', 3, '--delay', 60, 5);
  await page.waitForTimeout(600);
  const y1 = await page.evaluate(() => scrollY);
  xdo('mousemove', '--sync', ...schermo(k, c.x + 30, c.y + c.h / 2));
  await page.waitForTimeout(200);
  xdo('click', '--repeat', 3, '--delay', 60, 5);
  await page.waitForTimeout(600);
  const y2 = await page.evaluate(() => scrollY);
  console.log('rotella: vuoto', y1, 'carta', y2);
  const prima = (await contenuto(app)).schede;
  xdo('mousemove', '--sync', ...schermo(k, Math.max(2, c.x - 6), c.y + c.h / 2));
  await page.waitForTimeout(200);
  xdo('click', 2);
  await page.waitForTimeout(1500);
  const dopo = (await contenuto(app)).schede;
  console.log('clic centrale nel vuoto: schede', prima, '->', dopo, 'url', page.url());
  expect(y1).toBeGreaterThan(0);
});

test('tema scuro e tema chiaro: come si vede la carta sopra la pagina', async ({ app, shell, openTab, testServer, avvisi }) => {
  await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:100vh;background:#ffffff;font:16px sans-serif"><p style="padding:40px">Pagina bianca qualunque, con del testo.</p></body></html>`);
  await shell.evaluate(() => window.filoNotify('Scaricato: Fattura_settembre_2026.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }] }));
  await avvisi();
  await shell.waitForTimeout(1500);
  scatta('chiaro');
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await shell.waitForTimeout(1500);
  scatta('scuro');
  const vista = await avvisi();
  console.log('scuro, sfondo carta', await vista.evaluate(() => getComputedStyle(document.querySelector('.shell-notif')).backgroundColor), 'shell --tab-active', await shell.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tab-active')));
});

test('chiusa la scheda attiva con un avviso a schermo; finestra ridotta a icona e riaperta', async ({ app, shell, openTab, testServer, avvisi }) => {
  await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0;height:100vh;background:#0f0"><p>A</p></body></html>');
  const b = await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0;height:100vh;background:#00f"><p>B</p></body></html>');
  await shell.evaluate(() => window.filoNotify('Avviso che resta', { durationSec: 0 }));
  await avvisi();
  await shell.waitForTimeout(500);
  await app.evaluate(({ BrowserWindow }, u) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); const tm = w._filoTabs; tm.closeTab(tm.tabs.find((t) => t.view.webContents.getURL() === u).id); }, b.url());
  await shell.waitForTimeout(800);
  const k = await contenuto(app);
  console.log('dopo chiusura', JSON.stringify(k));
  const riserva = await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); const tm = w._filoTabs; const t = tm.tabs.find((x) => x.id === tm.activeId); return [t.view.webContents.getURL(), await t.view.webContents.executeJavaScript("getComputedStyle(document.documentElement).getPropertyValue('--filo-avvisi-barra')")]; });
  console.log('riserva nella nuova attiva', JSON.stringify(riserva));
  scatta('chiusa');
  expect(k.inCima).toBe(true);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.minimize(); });
  await shell.waitForTimeout(1000);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.restore(); w.focus(); });
  await shell.waitForTimeout(1200);
  const k2 = await contenuto(app);
  console.log('dopo riapertura', JSON.stringify(k2));
  scatta('riaperta');
  expect(k2.inCima).toBe(true);
});

test('puntatore fermo nell’angolo quando arriva un avviso a tempo: se ne va da solo?', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0;height:100vh;background:#eee"><p>angolo</p></body></html>');
  const k0 = await contenuto(app);
  // Il puntatore parcheggiato dove comparirà la carta (a 60 px dal bordo destro, 40 dal basso).
  xdo('mousemove', '--sync', ...pagina(k0, k0.t.width - 80, k0.t.height - 40));
  await page.waitForTimeout(300);
  await shell.evaluate(() => window.filoNotify('Avviso breve', { durationSec: 2 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await page.waitForTimeout(6000);
  const resta = await shell.evaluate(() => document.querySelectorAll('.shell-notif:not([data-closing="1"])').length);
  console.log('dopo 6 s col puntatore fermo sopra: avvisi vivi', resta);
  xdo('mousemove', '--sync', ...pagina(k0, 100, 100));
  await page.waitForTimeout(4000);
  console.log('dopo 4 s col puntatore altrove: avvisi vivi', await shell.evaluate(() => document.querySelectorAll('.shell-notif:not([data-closing="1"])').length));
});

test('due avvisi: chiuso il più vecchio, il pulsante del più recente risponde subito', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0;height:100vh;background:#eee"><p>due avvisi</p></body></html>');
  await shell.evaluate(() => {
    window.__b = 0;
    window.filoNotify('Scaricato: primo.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }] });
  });
  const vista = await avvisi();
  await page.waitForTimeout(400);
  await shell.evaluate(() => window.filoNotify('Scaricato: secondo.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => { window.__b++; } }] }));
  await expect(vista.locator('.shell-notif.show')).toHaveCount(2);
  await page.waitForTimeout(1600);
  const k = await contenuto(app);
  const pos = await vista.evaluate(() => {
    const [a, b] = document.querySelectorAll('.shell-notif.show');
    const x = a.querySelector('.shell-notif-close').getBoundingClientRect();
    const p = b.querySelector('.shell-notif-action').getBoundingClientRect();
    return { x: { x: x.left + x.width / 2, y: x.top + x.height / 2 }, p: { x: p.left + p.width / 2, y: p.top + p.height / 2 } };
  });
  xdo('mousemove', '--sync', ...schermo(k, pos.x.x, pos.x.y));
  await page.waitForTimeout(150);
  xdo('click', 1);
  // Il pulsante del secondo avviso non si è mosso: lo si clicca.
  xdo('mousemove', '--sync', ...schermo(k, pos.p.x, pos.p.y));
  await page.waitForTimeout(400);
  const spento = await vista.evaluate(() => { const b = document.querySelectorAll('.shell-notif.show .shell-notif-action'); return [...b].map((x) => x.disabled); });
  const k2 = await contenuto(app);
  const pos2 = await vista.evaluate(() => { const p = document.querySelector('.shell-notif.show .shell-notif-action').getBoundingClientRect(); return { x: p.left + p.width / 2, y: p.top + p.height / 2 }; });
  console.log('dopo la chiusura: spenti', JSON.stringify(spento), 'vista prima', JSON.stringify(k.vista), 'dopo', JSON.stringify(k2.vista), 'pulsante prima', JSON.stringify(schermo(k, pos.p.x, pos.p.y)), 'dopo', JSON.stringify(schermo(k2, pos2.x, pos2.y)));
  scatta('due-avvisi');
  xdo('click', 1);
  await page.waitForTimeout(500);
  console.log('clic sul pulsante del secondo, 550 ms dopo la chiusura del primo: azioni', await shell.evaluate(() => window.__b));
  expect(await shell.evaluate(() => window.__b)).toBe(1);
});

test('tasto indietro del mouse: nella pagina e nel vuoto accanto alla carta', async ({ app, shell, openTab, testServer, avvisi }) => {
  const a = testServer.html('<!doctype html><html><body style="margin:0;height:100vh;background:#cfc"><p>pagina A</p></body></html>');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:100vh;background:#eee"><a id="l" href="${a}">vai ad A</a></body></html>`);
  const inizio = page.url();
  await page.locator('#l').click();
  await expect.poll(() => page.url()).toBe(a);
  await page.waitForTimeout(500);
  const k0 = await contenuto(app);
  xdo('mousemove', '--sync', ...pagina(k0, 300, 300));
  await page.waitForTimeout(200);
  xdo('click', 8);
  await page.waitForTimeout(1200);
  console.log('tasto indietro nella pagina: url', page.url() === inizio ? 'tornata indietro' : page.url());
  await page.locator('#l').click();
  await expect.poll(() => page.url()).toBe(a);
  await shell.evaluate(() => window.filoNotify('Scaricato: prova.pdf', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await page.waitForTimeout(600);
  const k = await contenuto(app);
  const c = await cartaRect(vista);
  xdo('mousemove', '--sync', ...schermo(k, Math.max(2, c.x - 6), c.y + c.h / 2));
  await page.waitForTimeout(300);
  xdo('click', 8);
  await page.waitForTimeout(1200);
  console.log('tasto indietro nel vuoto: url', page.url() === inizio ? 'tornata indietro' : page.url());
});

test('chiuso con la X l’avviso di sopra, il puntatore resta sulla pagina: quello di sotto riprende il suo tempo?', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0;height:100vh;background:#eee"><p>tempo</p></body></html>');
  await shell.evaluate(() => window.filoNotify('Avviso di sopra, da chiudere con la X', { durationSec: 0 }));
  const vista = await avvisi();
  await page.waitForTimeout(300);
  await shell.evaluate(() => window.filoNotify('Avviso di sotto, a tempo', { durationSec: 3 }));
  await expect(vista.locator('.shell-notif.show')).toHaveCount(2);
  await page.waitForTimeout(700);
  const k = await contenuto(app);
  const x = await vista.evaluate(() => { const r = document.querySelector('.shell-notif.show .shell-notif-close').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const [sx, sy] = schermo(k, x.x, x.y);
  xdo('mousemove', '--sync', sx - 30, sy);
  await page.waitForTimeout(200);
  xdo('mousemove', '--sync', sx, sy);
  await page.waitForTimeout(400);
  xdo('click', 1);
  await page.waitForTimeout(500);
  // Il puntatore ora è sopra la pagina (la vista si è accorciata dall'alto): lo si muove un po' lì.
  for (let i = 1; i <= 5; i++) { xdo('mousemove', '--sync', sx - 20 * i, sy - 10 * i); await page.waitForTimeout(80); }
  const k2 = await contenuto(app);
  console.log('vista dopo la X', JSON.stringify(k2.vista), 'puntatore', sx - 100, sy - 50);
  await page.waitForTimeout(6000);
  const vivi = await shell.evaluate(() => document.querySelectorAll('.shell-notif:not([data-closing="1"])').length);
  console.log('6 s dopo, col puntatore sulla pagina: avvisi vivi', vivi);
  expect(vivi).toBe(0);
});
