// Esplorazione del giro 3 di #588.5 col mouse, la tastiera e lo schermo veri (xdotool e scrot sullo
// schermo virtuale): l'avviso si VEDE sui pixel dello schermo, e i gesti dell'utente fanno quello che dicono.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('tests/.shots/588.5-giro3');
mkdirSync(OUT, { recursive: true });
const xdo = (...a) => execFileSync('xdotool', a.map(String));
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

test.skip(!process.env.DISPLAY, 'serve lo schermo virtuale');

async function inVista(app, w = 900, h = 600) {
  await app.evaluate(({ BrowserWindow }, { w, h }) => {
    const win = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    win.setOpacity?.(1);
    win.setPosition(0, 0);
    win.setContentSize(w, h);
    win.show();
    win.focus();
  }, { w, h });
  await pausa(600);
}

function geometria(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    const figli = w.contentView.children;
    return {
      c: w.getContentBounds(),
      t: tab.view.getBounds(),
      v: tm.avvisi.vista ? tm.avvisi.vista.getBounds() : null,
      inCima: !!tm.avvisi.vista && figli[figli.length - 1] === tm.avvisi.vista,
    };
  });
}

async function scatta(nome) {
  const f = resolve(OUT, `${nome}.png`);
  execFileSync('scrot', ['-o', f]);
  return f;
}

function pixel(app, file, x, y) {
  return app.evaluate(({ nativeImage }, { file, x, y }) => {
    const img = nativeImage.createFromPath(file);
    const { width } = img.getSize();
    const b = img.toBitmap();
    const i = (Math.round(y) * width + Math.round(x)) * 4;
    return [b[i + 2], b[i + 1], b[i]];
  }, { file, x, y });
}
const verde = ([r, g, b]) => g > 150 && r < 80 && b < 80;

// Centro di un elemento della vista, in coordinate dello schermo.
async function aSchermo(app, vista, sel) {
  const g = await geometria(app);
  const r = await vista.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  return { x: Math.round(g.c.x + g.v.x + r.x), y: Math.round(g.c.y + g.v.y + r.y) };
}
async function paginaASchermo(app, page, sel, dx = 0) {
  const g = await geometria(app);
  const r = await page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  return { x: Math.round(g.c.x + g.t.x + r.x + dx), y: Math.round(g.c.y + g.t.y + r.y) };
}
const clicca = ({ x, y }, tasto = 1) => { xdo('mousemove', x - 3, y - 3); xdo('mousemove', x, y); xdo('click', tasto); };

function serverFile(modo) {
  const FILE = Buffer.from('%PDF-1.4\n% finto pdf\n' + 'x'.repeat(4096));
  const s = createServer((req, res) => {
    if (req.url.startsWith('/rotto')) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': 500000, 'Content-Disposition': 'attachment; filename="rotto.zip"' });
      res.write(Buffer.alloc(2000, 1));
      setTimeout(() => req.socket.destroy(), 300);
      return;
    }
    const h = { 'Content-Type': 'application/pdf', 'Content-Length': FILE.length };
    if (modo === 'allegato') h['Content-Disposition'] = 'attachment; filename="report.pdf"';
    res.writeHead(200, h);
    res.end(FILE);
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ s, base: `http://127.0.0.1:${s.address().port}` })));
}

test('la lamentela: un pdf scaricato da un collegamento mostra «Scaricato» SULLO SCHERMO, e «Apri file» col mouse vero lo apre', async ({ app, shell, openTab, testServer, avvisi }) => {
  const { s, base } = await serverFile('pdf');
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;background:#00c000;height:2000px">
      <a id="dl" href="${base}/report.pdf" style="display:inline-block;margin:40px;font:20px sans-serif;background:#fff">Scarica il report</a></body></html>`);
    await app.evaluate(({ shell: sh }) => {
      globalThis.__aperti = [];
      sh.openPath = async (p) => { globalThis.__aperti.push(p); return ''; };
    });
    await inVista(app);
    const prima = await scatta('0-prima');
    clicca(await paginaASchermo(app, page, '#dl'));
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show .shell-notif-msg')).toHaveText(/Scaricato: report.*\.pdf/, { timeout: 20_000 });
    await expect.poll(async () => (await geometria(app)).inCima).toBe(true);
    await pausa(700);
    const dopo = await scatta('1-scaricato');
    const centro = await aSchermo(app, vista, '.shell-notif-msg');
    console.log('pixel sotto la carta prima', await pixel(app, prima, centro.x, centro.y), 'dopo', await pixel(app, dopo, centro.x, centro.y));
    expect(verde(await pixel(app, prima, centro.x, centro.y))).toBe(true);
    expect(verde(await pixel(app, dopo, centro.x, centro.y))).toBe(false);
    // Il bottone «Apri file», col mouse vero, dopo che si è armato.
    await pausa(1100);
    clicca(await aSchermo(app, vista, '.shell-notif-action'));
    await expect.poll(() => app.evaluate(() => globalThis.__aperti.length), { timeout: 5000 }).toBe(1);
    console.log('aperto', await app.evaluate(() => globalThis.__aperti[0]));
  } finally {
    await new Promise((r) => s.close(r));
  }
});

test('uno scaricamento che cade mostra «Scaricamento non riuscito» sullo schermo', async ({ app, openTab, testServer, avvisi }) => {
  test.setTimeout(90_000);
  const { s, base } = await serverFile('pdf');
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;background:#00c000">
      <a id="dl" href="${base}/rotto.zip" style="display:inline-block;margin:40px;font:20px sans-serif;background:#fff">Scarica</a></body></html>`);
    await inVista(app);
    clicca(await paginaASchermo(app, page, '#dl'));
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show .shell-notif-msg')).toHaveText(/Scaricamento non riuscito/, { timeout: 45_000 });
    await pausa(700);
    const f = await scatta('2-non-riuscito');
    const centro = await aSchermo(app, vista, '.shell-notif-msg');
    expect(verde(await pixel(app, f, centro.x, centro.y))).toBe(false);
  } finally {
    await new Promise((r) => s.close(r));
  }
});

test('tastiera: chi scrive nella pagina continua a scrivere col primo avviso, dopo un clic sul testo della carta e dopo un clic su un pulsante spento', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0"><input id="campo" style="margin:40px;width:300px"></body></html>');
  await inVista(app);
  clicca(await paginaASchermo(app, page, '#campo'));
  xdo('type', '--delay', '40', 'ab');
  await expect.poll(() => page.evaluate(() => document.getElementById('campo').value)).toBe('ab');
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  xdo('type', '--delay', '40', 'cd');
  await expect.poll(() => page.evaluate(() => document.getElementById('campo').value)).toBe('abcd');
  await expect.poll(async () => ((await geometria(app)).v || {}).width || 0).toBeGreaterThan(100);
  clicca(await aSchermo(app, vista, '.shell-notif-msg'));
  await pausa(300);
  xdo('type', '--delay', '40', 'ef');
  await expect.poll(() => page.evaluate(() => document.getElementById('campo').value)).toBe('abcdef');
  // Un secondo avviso: il clic sul suo pulsante nel secondo in cui è spento.
  await shell.evaluate(() => window.filoNotify('Bloccato popup', { durationSec: 0, actions: [{ label: 'Apri', onClick: () => {} }] }));
  await expect(vista.locator('.shell-notif.show')).toHaveCount(2);
  await pausa(150);
  clicca(await aSchermo(app, vista, '.shell-notif:last-child .shell-notif-action'));
  await pausa(300);
  xdo('type', '--delay', '40', 'gh');
  await expect.poll(() => page.evaluate(() => document.getElementById('campo').value)).toBe('abcdefgh');
});

test('margine e tasto destro col mouse vero: il clic nel vuoto arriva alla pagina, il tasto destro sulla carta apre il menu e la scelta funziona', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:3000px">
    <button id="angolo" style="position:fixed;right:3px;bottom:3px;width:10px;height:10px;padding:0" onclick="window.__n=(window.__n||0)+1"></button>
    </body></html>`);
  await inVista(app);
  await shell.evaluate(() => {
    window.__cartella = 0;
    window.filoNotify('Scaricato: report.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => { window.__cartella++; } }] });
  });
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await expect.poll(async () => ((await geometria(app)).v || {}).width || 0).toBeGreaterThan(100);
  clicca(await paginaASchermo(app, page, '#angolo'));
  await expect.poll(() => page.evaluate(() => window.__n || 0)).toBe(1);

  clicca(await aSchermo(app, vista, '.shell-notif-msg'), 3);
  let menu = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try { if (await w.evaluate(() => [...document.querySelectorAll('button.item')].some((b) => /Apri cartella/.test(b.textContent)))) { menu = w; return true; } } catch (_) {}
    }
    return false;
  }, { timeout: 8000 }).toBe(true);
  await pausa(300);
  const voce = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const m = BrowserWindow.getAllWindows().find((w) => w !== win && w.getParentWindow() === win && w.isVisible() && w.getBounds().height > 60);
    const r = await m.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button.item')].find((x) => /Apri cartella/.test(x.textContent)).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    const cb = m.getContentBounds();
    return { x: Math.round(cb.x + r.x), y: Math.round(cb.y + r.y) };
  });
  await scatta('3-menu');
  clicca(voce);
  await expect.poll(() => shell.evaluate(() => window.__cartella), { timeout: 5000 }).toBe(1);
});

test('la X col mouse vero: suggerimento «Chiudi» e chiusura', async ({ app, shell, avvisi }) => {
  await inVista(app);
  await shell.evaluate(() => window.filoNotify('Avviso da chiudere', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await expect.poll(async () => ((await geometria(app)).v || {}).width || 0).toBeGreaterThan(100);
  const x = await aSchermo(app, vista, '.shell-notif-close');
  xdo('mousemove', x.x - 20, x.y); xdo('mousemove', x.x, x.y);
  await pausa(900);
  await scatta('4-suggerimento');
  xdo('click', 1);
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
});
