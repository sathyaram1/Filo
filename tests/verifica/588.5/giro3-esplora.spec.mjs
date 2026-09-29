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
  return app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    const figli = w.contentView.children;
    return {
      k: screen.getPrimaryDisplay().scaleFactor,
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
  return { x: Math.round((g.c.x + g.v.x + r.x) * g.k), y: Math.round((g.c.y + g.v.y + r.y) * g.k) };
}
async function paginaASchermo(app, page, sel, dx = 0) {
  const g = await geometria(app);
  const r = await page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  return { x: Math.round((g.c.x + g.t.x + r.x + dx) * g.k), y: Math.round((g.c.y + g.t.y + r.y) * g.k) };
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
  const { s, base } = await serverFile('allegato');
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
    await expect(shell.locator('.shell-notif')).toHaveCount(1, { timeout: 20_000 });
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

test('uno scaricamento che cade mostra «Scaricamento non riuscito» sullo schermo', async ({ app, shell, openTab, testServer, avvisi }) => {
  test.setTimeout(90_000);
  const { s, base } = await serverFile('pdf');
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;background:#00c000">
      <a id="dl" href="${base}/rotto.zip" style="display:inline-block;margin:40px;font:20px sans-serif;background:#fff">Scarica</a></body></html>`);
    await inVista(app);
    clicca(await paginaASchermo(app, page, '#dl'));
    await expect(shell.locator('.shell-notif')).toHaveCount(1, { timeout: 45_000 });
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show .shell-notif-msg')).toHaveText(/Scaricamento non riuscito/, { timeout: 5_000 });
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
  const voce = await app.evaluate(async ({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const m = BrowserWindow.getAllWindows().find((w) => w !== win && w.getParentWindow() === win && w.isVisible() && w.getBounds().height > 60);
    const r = await m.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button.item')].find((x) => /Apri cartella/.test(x.textContent)).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    const cb = m.getContentBounds();
    const k = screen.getPrimaryDisplay().scaleFactor;
    return { x: Math.round((cb.x + r.x) * k), y: Math.round((cb.y + r.y) * k) };
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

test('finestra bassa e raffica: le carte restano dentro, la più recente in vista; testo lunghissimo senza spazi resta nella carta', async ({ app, shell, openTab, testServer, avvisi }) => {
  await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0;background:#00c000"></body></html>');
  await inVista(app, 720, 500);
  await shell.evaluate(() => {
    for (let i = 1; i <= 7; i++) window.filoNotify(`Avviso numero ${i} ` + (i === 7 ? 'x'.repeat(400) : ''), { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }] });
  });
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(5);
  await pausa(800);
  await scatta('5-raffica');
  const g = await geometria(app);
  console.log('geometria raffica', JSON.stringify(g));
  const m = await vista.evaluate(() => {
    const v = document.getElementById('vassoio');
    const ultima = [...document.querySelectorAll('.shell-notif')].pop().getBoundingClientRect();
    return { sh: v.scrollHeight, ch: v.clientHeight, st: v.scrollTop, ultima: { top: ultima.top, bottom: ultima.bottom, left: ultima.left, right: ultima.right, w: ultima.width }, iw: innerWidth, ih: innerHeight };
  });
  console.log('pila', JSON.stringify(m));
  expect(g.v.y).toBeGreaterThanOrEqual(g.t.y);
  expect(m.ultima.bottom).toBeLessThanOrEqual(m.ih + 1);
  expect(m.ultima.right).toBeLessThanOrEqual(m.iw + 1);
  expect(m.ultima.left).toBeGreaterThanOrEqual(0);
});

test('schermo intero, scheda nuova da tastiera, ridimensionamento: l’avviso resta sopra e nell’angolo', async ({ app, shell, openTab, testServer, avvisi }) => {
  await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0;background:#00c000"></body></html>');
  await inVista(app);
  await shell.evaluate(() => window.filoNotify('Resta sopra', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await expect.poll(async () => (await geometria(app)).inCima).toBe(true);
  // Scheda nuova con Ctrl+T dalla tastiera vera.
  clicca({ x: 400, y: 300 });
  xdo('key', 'ctrl+t');
  await pausa(1200);
  let g = await geometria(app);
  console.log('dopo ctrl+t', JSON.stringify(g));
  expect(g.inCima).toBe(true);
  // Ridimensionamento.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(1000, 700));
  await pausa(600);
  g = await geometria(app);
  expect(g.v.x + g.v.width).toBe(1000);
  expect(g.v.y + g.v.height).toBe(700);
  // Schermo intero dei contenuti (menu «Schermo intero»).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.setContentFullscreen(true));
  await pausa(800);
  g = await geometria(app);
  console.log('schermo intero', JSON.stringify(g));
  expect(g.inCima).toBe(true);
  expect(g.v.width).toBeGreaterThan(100);
  await scatta('6-schermo-intero');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.setContentFullscreen(false));
});

test('schermo intero chiesto da un video della pagina: l’avviso che arriva si vede', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;background:#00c000">
    <div id="palco" style="width:300px;height:200px;background:#0000c0"></div>
    <button id="fs" onclick="document.getElementById('palco').requestFullscreen()">schermo intero</button></body></html>`);
  await inVista(app);
  clicca(await paginaASchermo(app, page, '#fs'));
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await pausa(1500);
  await shell.evaluate(() => window.filoNotify('Scaricato: film.mp4', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await pausa(800);
  const g = await geometria(app);
  console.log('fs pagina', JSON.stringify(g));
  const f = await scatta('7-fullscreen-pagina');
  const c = await aSchermo(app, vista, '.shell-notif-msg');
  console.log('pixel', await pixel(app, f, c.x, c.y));
  xdo('key', 'Escape');
  await pausa(800);
});

test('incognito: l’avviso compare sopra la pagina della finestra incognito, coi suoi colori', async ({ app, shell }) => {
  await shell.evaluate(() => window.filoShell.openIncognito());
  let inc = null;
  await expect.poll(async () => {
    inc = app.windows().find((w) => { try { return /shell\.html\?incognito=1/.test(w.url()); } catch (_) { return false; } });
    return !!inc;
  }, { timeout: 10000 }).toBe(true);
  await inc.waitForLoadState('domcontentloaded');
  await pausa(1500);
  await inc.evaluate(() => window.filoNotify('Avviso in incognito', { durationSec: 0 }));
  let vi = null;
  await expect.poll(async () => {
    const vs = app.windows().filter((w) => { try { return w.url().startsWith('filo://shell/avvisi.html'); } catch (_) { return false; } });
    for (const v of vs) { try { if (await v.locator('.shell-notif.show', { hasText: 'incognito' }).count()) { vi = v; return true; } } catch (_) {} }
    return false;
  }, { timeout: 10000 }).toBe(true);
  const colori = await Promise.all([
    vi.evaluate(() => getComputedStyle(document.querySelector('.shell-notif')).backgroundColor),
    inc.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tab-active')),
    shell.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tab-active')),
  ]);
  console.log('colori incognito: carta, --tab-active incognito, --tab-active normale', JSON.stringify(colori));
  const pos = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
    const tm = w._filoTabs;
    const figli = w.contentView.children;
    return { inCima: figli[figli.length - 1] === tm.avvisi.vista, v: tm.avvisi.vista.getBounds(), size: w.getContentSize() };
  });
  console.log('incognito posa', JSON.stringify(pos));
  expect(pos.inCima).toBe(true);
});

async function toastPagina(page) {
  await page.evaluate(() => {
    let h = document.querySelector('.sn-toasts');
    if (!h) { h = document.createElement('div'); h.className = 'sn-toasts'; document.documentElement.appendChild(h); }
    h.innerHTML = '<div id="tp" style="height:40px;width:200px;background:#c00000">avviso della pagina</div>';
  });
}
async function scartoPagina(app, page) {
  const barra = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.avvisi.vista.getBounds().height);
  const fondo = await page.evaluate(() => innerHeight - document.getElementById('tp').getBoundingClientRect().bottom);
  return Math.round(fondo) - barra;
}

test('navigazione e cambio scheda con un avviso aperto: gli avvisi della pagina restano sopra quelli della barra', async ({ app, shell, openTab, testServer, avvisi }) => {
  const url2 = testServer.html('<!doctype html><html><body style="margin:0"><p>seconda pagina</p></body></html>');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0"><a id="va" href="${url2}">vai</a></body></html>`);
  await inVista(app);
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await expect.poll(async () => ((await geometria(app)).v || {}).height || 0).toBeGreaterThan(50);
  await toastPagina(page);
  await expect.poll(() => scartoPagina(app, page)).toBeGreaterThanOrEqual(-1);
  clicca(await paginaASchermo(app, page, '#va'));
  await expect.poll(() => page.evaluate(() => document.body.innerText).catch(() => '')).toContain('seconda');
  await page.waitForLoadState('load');
  await pausa(500);
  await toastPagina(page);
  await expect.poll(() => scartoPagina(app, page), { timeout: 5000 }).toBeGreaterThanOrEqual(-1);
  // Una scheda nuova, attiva: la sua pila sale anche lì.
  const p2 = await openTab(testServer.html('<!doctype html><html><body style="margin:0"><p>terza</p></body></html>'));
  await p2.waitForLoadState('domcontentloaded');
  await expect.poll(async () => (await geometria(app)).inCima).toBe(true);
  await toastPagina(p2);
  await expect.poll(() => scartoPagina(app, p2), { timeout: 5000 }).toBeGreaterThanOrEqual(-1);
});

test('selezione trascinando col mouse vero, partita dal vuoto accanto alla carta', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <p id="riga" style="position:fixed;right:4px;bottom:4px;margin:0;font:14px sans-serif;white-space:nowrap">alfa beta gamma delta epsilon zeta eta theta iota kappa lambda</p></body></html>`);
  await inVista(app);
  await shell.evaluate(() => window.filoNotify('corto', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await expect.poll(async () => ((await geometria(app)).v || {}).width || 0).toBeGreaterThan(50);
  const g = await geometria(app);
  const r = await page.evaluate(() => { const b = document.getElementById('riga').getBoundingClientRect(); return { l: b.left, r: b.right, y: b.top + b.height / 2 }; });
  const y = Math.round((g.c.y + g.t.y + r.y) * g.k);
  const xDa = Math.round((g.c.x + g.t.x + r.r - 3) * g.k);
  const xA = Math.round((g.c.x + g.t.x + r.l + 40) * g.k);
  const vx = g.c.x + g.v.x;
  console.log('selezione da', xDa, 'a', xA, 'y', y, 'vista x da', vx * g.k, 'y da', (g.c.y + g.v.y) * g.k);
  xdo('mousemove', xDa, y); await pausa(100);
  xdo('mousedown', 1); await pausa(100);
  for (let x = xDa; x > xA; x -= 40) { xdo('mousemove', x, y); await pausa(30); }
  xdo('mousemove', xA, y); await pausa(100);
  xdo('mouseup', 1); await pausa(300);
  const sel = await page.evaluate(() => String(getSelection()));
  console.log('selezionato', JSON.stringify(sel));
  expect(sel.length).toBeGreaterThan(20);
});

test('riquadro Aiuto aperto: l’avviso della barra non copre la sua riga per scrivere', async ({ app, shell, avvisi }) => {
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } }); return !!page; }, { timeout: 10000 }).toBe(true);
  await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 });
  await inVista(app, 1280, 800);
  await page.evaluate(() => window.SN_SIDEBAR.open());
  await page.waitForSelector('.sn-sidebar-input', { timeout: 8000 });
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await pausa(800);
  await scatta('8-aiuto');
  const g = await geometria(app);
  const input = await page.evaluate(() => { const r = document.querySelector('.sn-sidebar-input').getBoundingClientRect(); return { x: r.left, y: r.top, right: r.right, bottom: r.bottom }; });
  const carta = await vista.evaluate(() => { const r = document.querySelector('.shell-notif').getBoundingClientRect(); return { x: r.left, y: r.top, right: r.right, bottom: r.bottom }; });
  const dx = g.v.x - g.t.x;
  const dy = g.v.y - g.t.y;
  const coperto = input.x < carta.right + dx && carta.x + dx < input.right && input.y < carta.bottom + dy && carta.y + dy < input.bottom;
  console.log('riga Aiuto', JSON.stringify(input), 'carta nella scheda', JSON.stringify({ x: carta.x + dx, y: carta.y + dy, right: carta.right + dx, bottom: carta.bottom + dy }), 'coperto', coperto);
  expect(coperto).toBe(false);
});

test('col mouse fermo sopra la carta il tempo dell’avviso continua a correre, e l’avviso sparisce sotto il puntatore', async ({ app, shell, openTab, testServer, avvisi }) => {
  await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0;background:#00c000"></body></html>');
  await inVista(app);
  await shell.emulateMedia({ colorScheme: 'dark' });
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 3, actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await expect.poll(async () => ((await geometria(app)).v || {}).width || 0).toBeGreaterThan(100);
  const p = await aSchermo(app, vista, '.shell-notif-msg');
  xdo('mousemove', p.x - 10, p.y); xdo('mousemove', p.x, p.y);
  await pausa(1500);
  await scatta('9-scuro');
  expect(await vista.evaluate(() => document.querySelector('.shell-notif:hover') !== null)).toBe(true);
  await pausa(2500);
  xdo('mousemove', p.x + 1, p.y);
  await pausa(300);
  // Col puntatore sopra da quattro secondi, l'avviso c'è ancora?
  await expect(shell.locator('.shell-notif')).toHaveCount(1);
});

test('raffica di avvisi aperti e chiusi in fretta, anche prima che la vista sia pronta: alla fine si vede quello che c’è', async ({ app, shell, avvisi }) => {
  await shell.evaluate(async () => {
    const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 30; i++) {
      const c = window.filoNotify(`lampo ${i}`, { durationSec: 0 });
      await attesa(i % 3 === 0 ? 0 : 7);
      c.querySelector('.shell-notif-close').click();
    }
    window.filoNotify('resta', { durationSec: 0 });
  });
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await expect(vista.locator('.shell-notif.show .shell-notif-msg')).toHaveText('resta');
  await expect.poll(async () => { const v = (await geometria(app)).v; return v && v.width > 100 && v.height > 30; }).toBe(true);
  await pausa(600);
  await expect(vista.locator('.shell-notif')).toHaveCount(1);
  await shell.evaluate(() => document.querySelector('.shell-notif-close').click());
  await expect.poll(async () => ((await geometria(app)).v || {}).width).toBe(0);
});
