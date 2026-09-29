// Verifica #588.5 giro 4 — esplorazione sullo schermo vero (scrot + xdotool): quello che l'utente vede e clicca.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SHOTS = resolve('tests/.shots');
mkdirSync(SHOTS, { recursive: true });
test.setTimeout(120000);
const PDF = Buffer.from('%PDF-1.4\n% finto\n' + 'x'.repeat(4096));

function scatta(nome) {
  const p = join(SHOTS, `588.5-g4-${nome}.png`);
  try { execFileSync('scrot', ['-o', p]); } catch (e) { console.log('scrot', e.message); }
  return p;
}
const xdo = (...a) => execFileSync('xdotool', a.map(String));

async function contenuto(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && w.isFocused()) || BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const c = win.getContentBounds();
    const v = win._filoTabs.avvisi.vista;
    const figli = win.contentView.children;
    return { c, vista: v ? v.getBounds() : null, inCima: !!v && figli[figli.length - 1] === v, visibile: !!v && v.getBounds().width > 0 };
  });
}

// Colore medio di un rettangolo dello schermo (coordinate schermo), letto dal PNG con nativeImage.
async function colore(app, file, r) {
  return app.evaluate(({ nativeImage }, { file, r }) => {
    const img = nativeImage.createFromPath(file);
    const c = img.crop({ x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.w)), height: Math.max(1, Math.round(r.h)) });
    const b = c.toBitmap();
    let R = 0, G = 0, B = 0, n = 0;
    for (let i = 0; i < b.length; i += 4) { B += b[i]; G += b[i + 1]; R += b[i + 2]; n++; }
    return { r: Math.round(R / n), g: Math.round(G / n), b: Math.round(B / n), size: img.getSize() };
  }, { file, r });
}

async function vistaAvvisi(app, ms = 40000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/avvisi.html'); } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 200));
  }
  const urls = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().flatMap((w) => (w._filoTabs ? w._filoTabs.tabs.map((t) => t.view.webContents.getURL()) : [])));
  const dl = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); return w.webContents.executeJavaScript("document.getElementById('shell-notifs') ? document.getElementById('shell-notifs').textContent : 'nessuna pila'"); });
  throw new Error('vista non nata; schede: ' + JSON.stringify(urls) + ' pila: ' + dl);
}

function serverFile(handler) {
  const s = createServer(handler);
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(s)));
}

test('pdf cliccato: l’avviso si VEDE sullo schermo e «Apri cartella» risponde al mouse vero', async ({ app, shell, openTab, testServer, avvisi }) => {
  const srv = await serverFile((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length });
    res.end(PDF);
  });
  const url = `http://127.0.0.1:${srv.address().port}/manuale.pdf`;
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;background:#00ff00;height:100vh">
      <a id="dl" href="${url}" style="display:block;padding:40px;font-size:30px">manuale.pdf</a></body></html>`);
    await app.evaluate(({ shell: sh }) => { globalThis.__cartelle = []; sh.showItemInFolder = (p) => { globalThis.__cartelle.push(p); }; });
    await page.locator('#dl').click();
    const vista = await vistaAvvisi(app, 20000);
    await expect(vista.locator('.shell-notif.show .shell-notif-msg')).toContainText('Scaricato', { timeout: 15000 });
    await page.waitForTimeout(400);
    const k = await contenuto(app);
    console.log('posa', JSON.stringify(k));
    const f = scatta('pdf');
    // La carta: dentro la vista, a sinistra della X. Non deve essere verde (la pagina).
    const card = await vista.evaluate(() => { const r = document.querySelector('.shell-notif.show').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const zona = { x: k.c.x + k.vista.x + card.x + 10, y: k.c.y + k.vista.y + card.y + 10, w: card.w - 40, h: card.h - 20 };
    const col = await colore(app, f, zona);
    console.log('colore carta', JSON.stringify(col));
    expect(col.g > 200 && col.r < 60 && col.b < 60).toBe(false);

    // Mouse vero sopra «Apri cartella» (dopo l'armatura): clic.
    await page.waitForTimeout(1100);
    const bt = await vista.evaluate(() => { const b = [...document.querySelectorAll('.shell-notif-action')].find((x) => /Apri cartella/.test(x.textContent)); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    xdo('mousemove', '--sync', Math.round(k.c.x + k.vista.x + bt.x), Math.round(k.c.y + k.vista.y + bt.y));
    await page.waitForTimeout(300);
    xdo('click', 1);
    await expect.poll(() => app.evaluate(() => globalThis.__cartelle.length), { timeout: 5000 }).toBe(1);
  } finally { srv.close(); }
});

test('scaricamento caduto a metà: «Scaricamento non riuscito» si vede sopra la pagina', async ({ app, openTab, testServer, avvisi }) => {
  const srv = await serverFile((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': 500000, 'Content-Disposition': 'attachment; filename="rotto.pdf"' });
    res.write(PDF);
    setTimeout(() => res.socket.destroy(), 300);
  });
  const url = `http://127.0.0.1:${srv.address().port}/rotto.pdf`;
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;background:#00ff00;height:100vh"><a id="dl" href="${url}">rotto</a></body></html>`);
    await page.locator('#dl').click();
    const vista = await vistaAvvisi(app, 60000);
    await expect(vista.locator('.shell-notif.show .shell-notif-msg')).toContainText('non riuscito', { timeout: 30000 });
    await page.waitForTimeout(400);
    const k = await contenuto(app);
    expect(k.inCima && k.visibile).toBe(true);
    const f = scatta('non-riuscito');
    const card = await vista.evaluate(() => { const r = document.querySelector('.shell-notif.show').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const col = await colore(app, f, { x: k.c.x + k.vista.x + card.x + 10, y: k.c.y + k.vista.y + card.y + 8, w: card.w - 40, h: card.h - 16 });
    console.log('colore carta', JSON.stringify(col));
    expect(col.g > 200 && col.r < 60 && col.b < 60).toBe(false);
  } finally { srv.close(); }
});

test('finestra incognito: l’avviso di fine scaricamento si vede lì sopra la pagina', async ({ app, shell, avvisi }) => {
  const srv = await serverFile((req, res) => {
    if (req.url.startsWith('/pagina')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><html><body style="margin:0;background:#00ff00;height:100vh"><a id="dl" href="/f.pdf" style="font-size:30px">f</a></body></html>`);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length, 'Content-Disposition': 'attachment; filename="segreto.pdf"' });
    res.end(PDF);
  });
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const prima = app.windows().length;
    await shell.evaluate(() => window.filoShell.openIncognito());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w._filoIncognito && w._filoTabs).length)).toBe(1);
    await app.evaluate(({ BrowserWindow }, u) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
      w.focus();
      w._filoTabs.openTab(u);
    }, base + '/pagina');
    let page = null;
    await expect.poll(() => { page = app.windows().find((w) => { try { return w.url().startsWith(base + '/pagina'); } catch (_) { return false; } }); return !!page; }, { timeout: 15000 }).toBe(true);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#dl').click();
    const info = await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
      const v = w._filoTabs.avvisi.vista;
      const f = w.contentView.children;
      return !!v && f[f.length - 1] === v && v.getBounds().width > 100;
    }), { timeout: 15000 }).toBe(true);
    await page.waitForTimeout(500);
    scatta('incognito');
    // Colori incognito nella vista?
    const temi = await app.evaluate(async ({ BrowserWindow, webContents }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
      const v = w._filoTabs.avvisi.vista;
      const vistaBg = await v.webContents.executeJavaScript("getComputedStyle(document.querySelector('.shell-notif')).backgroundColor");
      const shellBg = await w.webContents.executeJavaScript("getComputedStyle(document.documentElement).getPropertyValue('--bg')");
      return { vistaBg, shellBg, testo: await v.webContents.executeJavaScript("document.querySelector('.shell-notif-msg').textContent") };
    });
    console.log('incognito', JSON.stringify(temi));
    expect(temi.testo).toContain('segreto.pdf');
  } finally { srv.close(); }
});

test('tastiera vera: si scrive in un campo, arriva l’avviso, si continua a scrivere; clic vero sulla carta e ancora', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;background:#eee;height:100vh"><input id="q" style="margin:40px;font-size:24px;width:400px"></body></html>`);
  const k0 = await contenuto(app);
  const r = await page.locator('#q').boundingBox();
  xdo('mousemove', '--sync', Math.round(k0.c.x + r.x + 20), Math.round(k0.c.y + 88 + r.y + r.height / 2));
  // la scheda sta sotto la cornice: la y vera la chiedo alla scheda
  const tb = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId); return t.view.getBounds(); });
  xdo('mousemove', '--sync', Math.round(k0.c.x + tb.x + r.x + 20), Math.round(k0.c.y + tb.y + r.y + r.height / 2));
  xdo('click', 1);
  await page.waitForTimeout(200);
  xdo('type', '--delay', 30, 'abc');
  await expect(page.locator('#q')).toHaveValue('abc');
  await shell.evaluate(() => window.filoNotify('Scaricato: prova.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await page.waitForTimeout(500);
  xdo('type', '--delay', 30, 'def');
  await expect(page.locator('#q')).toHaveValue('abcdef');
  // Clic vero sul testo della carta.
  const k = await contenuto(app);
  const m = await vista.evaluate(() => { const r = document.querySelector('.shell-notif-msg').getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; });
  xdo('mousemove', '--sync', Math.round(k.c.x + k.vista.x + m.x), Math.round(k.c.y + k.vista.y + m.y));
  xdo('click', 1);
  await page.waitForTimeout(400);
  xdo('type', '--delay', 30, 'ghi');
  await expect(page.locator('#q')).toHaveValue('abcdefghi');
  // Clic vero nella X
  const x = await vista.evaluate(() => { const r = document.querySelector('.shell-notif-close').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  xdo('mousemove', '--sync', Math.round(k.c.x + k.vista.x + x.x), Math.round(k.c.y + k.vista.y + x.y));
  await page.waitForTimeout(700);
  scatta('x-hover');
  xdo('click', 1);
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
  xdo('type', '--delay', 30, 'jkl');
  await expect(page.locator('#q')).toHaveValue('abcdefghijkl');
});

test('cambio scheda con un avviso aperto: la riserva passa alla scheda nuova e se ne va da tutte', async ({ app, shell, openTab, testServer, avvisi }) => {
  const a = await testServer.openReady(openTab, '<!doctype html><html><body><p>A</p></body></html>');
  await shell.evaluate(() => window.filoNotify('Avviso lungo', { durationSec: 0 }));
  await avvisi();
  const riserva = (p) => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--filo-avvisi-barra').trim());
  await expect.poll(() => riserva(a)).not.toBe('');
  const b = await testServer.openReady(openTab, '<!doctype html><html><body><p>B</p></body></html>');
  await expect.poll(() => riserva(b)).not.toBe('');
  await shell.evaluate(() => { for (const b of document.querySelectorAll('.shell-notif-close')) b.click(); });
  await expect.poll(() => riserva(b)).toBe('');
  // torna ad A
  await app.evaluate(({ BrowserWindow }, u) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); const tm = w._filoTabs; tm.activate(tm.tabs.find((t) => t.view.webContents.getURL() === u).id); }, a.url());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); const tm = w._filoTabs; return tm.tabs.find((t) => t.id === tm.activeId).view.webContents.getURL(); })).toBe(a.url());
  await expect.poll(() => riserva(a), { timeout: 5000 }).toBe('');
});

test('schermo intero e finestra bassa: la pila resta nell’angolo e intera', async ({ app, shell, openTab, testServer, avvisi }) => {
  await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0;background:#00ff00;height:100vh"><p>pagina</p></body></html>');
  for (let i = 0; i < 5; i++) await shell.evaluate((i) => window.filoNotify(`Avviso numero ${i} con un testo abbastanza lungo da andare a capo forse ${'parola '.repeat(i * 3)}`, { durationSec: 0, actions: i % 2 ? [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }] : [] }), i);
  await avvisi();
  await shell.waitForTimeout(600);
  scatta('cinque');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.setFullScreen(true); });
  await shell.waitForTimeout(1200);
  const k = await contenuto(app);
  console.log('fullscreen', JSON.stringify(k));
  scatta('fullscreen');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.setFullScreen(false); });
  await shell.waitForTimeout(1200);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.setContentSize(700, 360); });
  await shell.waitForTimeout(900);
  console.log('bassa', JSON.stringify(await contenuto(app)));
  scatta('bassa');
});

test('nome di file lunghissimo senza spazi ed emoji: la carta resta intera', async ({ app, shell, avvisi }) => {
  await shell.evaluate(() => window.filoNotify('Scaricato: ' + '📄'.repeat(3) + 'a'.repeat(300) + '.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }] }));
  const vista = await avvisi();
  await shell.waitForTimeout(600);
  const m = await vista.evaluate(() => { const r = document.querySelector('.shell-notif').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, sw: document.documentElement.scrollWidth }; });
  console.log('lungo', JSON.stringify(m), JSON.stringify(await contenuto(app)));
  scatta('lungo');
  expect(m.l).toBeGreaterThanOrEqual(0);
  expect(m.sw).toBeLessThanOrEqual(m.w);
});

test('la Home e le pagine di Filo: l’avviso sta sopra e non copre la riga per scrivere', async ({ app, shell, avvisi }) => {
  await shell.waitForTimeout(1500);
  await shell.evaluate(() => window.filoNotify('Scaricato: documento-importante.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }] }));
  await avvisi();
  await shell.waitForTimeout(800);
  console.log('home', JSON.stringify(await contenuto(app)));
  scatta('home');
});

test('tasto destro nella pagina accanto a un avviso: il riquadro di Filo', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;background:#fff;height:100vh;font-size:22px"><p style="position:absolute;bottom:30px;right:420px">parola vicina all'angolo</p></body></html>`);
  await shell.evaluate(() => window.filoNotify('Scaricato: documento-importante.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }] }));
  await avvisi();
  await page.waitForTimeout(600);
  const k = await contenuto(app);
  const tb = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId); return t.view.getBounds(); });
  const r = await page.locator('p').boundingBox();
  xdo('mousemove', '--sync', Math.round(k.c.x + tb.x + r.x + r.width - 10), Math.round(k.c.y + tb.y + r.y + r.height / 2));
  xdo('click', 3);
  await page.waitForTimeout(1200);
  console.log('destro', JSON.stringify(k), JSON.stringify(r));
  scatta('destro-pagina');
});
