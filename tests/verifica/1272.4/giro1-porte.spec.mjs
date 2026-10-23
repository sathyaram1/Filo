// Verifica #1272.4 giro 1: i file che Filo scarica per una pagina non portano a un altro sito i cookie che la pagina
// non potrebbe mandargli, nemmeno passando da un rimando o da un riquadro.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const nomi = (c) => String(c || '').split(';').map((x) => x.trim().split('=')[0]).filter(Boolean).sort();

// Un sito che annota chi chiede cosa; /rimanda?a=<url> rimbalza altrove, /pagina serve l'html dato.
async function sito(host, html = '') {
  const visti = [];
  const s = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    visti.push({ percorso: req.url, cookie: String(req.headers.cookie || ''), dest: String(req.headers['sec-fetch-dest'] || ''), modo: String(req.headers['sec-fetch-mode'] || '') });
    if (u.pathname === '/rimanda') { res.writeHead(302, { location: u.searchParams.get('a'), 'cache-control': 'no-store' }); res.end(); return; }
    if (u.pathname === '/pagina') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
    res.end(PNG);
  });
  await new Promise((r) => s.listen(0, host, r));
  return {
    visti,
    origine: `http://${host}:${s.address().port}`,
    set html(h) { html = h; },
    daFilo: (p) => visti.filter((v) => v.percorso.startsWith(p) && v.dest !== 'image' && v.dest !== 'iframe' && v.dest !== 'document'),
    dalMain: (p) => visti.filter((v) => v.percorso.includes(p) && v.dest === 'empty' && v.modo === 'no-cors'),
    chiudi: async () => { try { s.closeAllConnections(); } catch (_) {} await new Promise((r) => s.close(r)); },
  };
}

// Tasto destro vero sulla foto dentro il riquadro: descrizione e origine partono dai byte che scarica il main.
async function tastoDestro(page, frame) {
  const box = await (await frame.frameElement()).boundingBox();
  const r = await frame.evaluate(() => { const b = document.getElementById('foto').getBoundingClientRect(); return { x: b.x, y: b.y }; });
  await page.mouse.click(box.x + r.x + 10, box.y + r.y + 10, { button: 'right' });
}

async function cookieSu(app, url) {
  await app.evaluate(async ({ BrowserWindow }, url) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const ses = w._filoTabs.tabs[0].view.webContents.session;
    await ses.cookies.set({ url, name: 'stretto', value: '1', sameSite: 'strict' });
    await ses.cookies.set({ url, name: 'medio', value: '1', sameSite: 'lax' });
    await ses.cookies.set({ url, name: 'libero', value: '1', sameSite: 'no_restriction', secure: true });
  }, url);
}

test('icona della scheda dichiarata sul sito della pagina che rimanda a un altro sito: nessun cookie riservato', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const banca = await sito('localhost');
  const suo = await sito('127.0.0.1');
  try {
    const page = await testServer.openReady(openTab, '<!doctype html><title>Icona</title><p>ciao</p>');
    await cookieSu(app, `${banca.origine}/`);
    await page.evaluate((h) => { const l = document.createElement('link'); l.rel = 'icon'; l.href = h; document.head.appendChild(l); },
      `${suo.origine}/rimanda?a=${encodeURIComponent(`${banca.origine}/icona.png?azione=1`)}`);
    await expect.poll(() => banca.daFilo('/icona.png').length, { timeout: 15_000 }).toBeGreaterThan(0);
    for (const v of banca.daFilo('/icona.png')) expect(nomi(v.cookie)).not.toContain('stretto');
  } finally { await banca.chiudi(); await suo.chiudi(); }
});

test('immagine del sito della pagina che rimanda a un altro sito: solo i cookie concessi', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const banca = await sito('localhost');
  const suo = await sito('127.0.0.1');
  try {
    const src = `${suo.origine}/rimanda?a=${encodeURIComponent(`${banca.origine}/foto.png?x=1`)}`;
    const page = await testServer.openReady(openTab, `<!doctype html><title>p</title><img id="foto" src="${src}" width="50" height="50">`);
    await cookieSu(app, `${banca.origine}/`);
    const host = new URL(page.url()).hostname;
    const r = await page.evaluate(() => 1) && await app.evaluate(async ({ BrowserWindow }, { host, code }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const t = w._filoTabs.tabs.find((x) => { try { return new URL(x.view.webContents.getURL()).hostname === host; } catch (_) { return false; } });
      return t.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }]);
    }, { host, code: `SN_ACTIONS.scaricaImmagine(${JSON.stringify(src)}, document.getElementById('foto')).then((d) => d.slice(0, 22), (e) => 'errore: ' + e.message)` });
    expect(r).toBe('data:image/png;base64,');
    const letture = banca.daFilo('/foto.png');
    expect(letture.length).toBeGreaterThan(0);
    for (const v of letture) expect(nomi(v.cookie)).toEqual(['libero']);
  } finally { await banca.chiudi(); await suo.chiudi(); }
});

test('immagine dentro un riquadro di un altro sito: solo i cookie concessi', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const banca = await sito('127.0.0.1');
  const annuncio = await sito('localhost');
  try {
    const src = `${banca.origine}/foto.png?riquadro=1`;
    annuncio.html = `<!doctype html><title>ad</title><img id="foto" src="${src}" width="50" height="50">`;
    const page = await testServer.openReady(openTab, `<!doctype html><title>p</title><iframe id="f" src="${annuncio.origine}/pagina" width="300" height="200"></iframe>`);
    await cookieSu(app, `${banca.origine}/`);
    const frame = page.frames().find((f) => f.url().startsWith(annuncio.origine));
    expect(frame).toBeTruthy();
    await frame.waitForFunction(() => document.getElementById('foto')?.complete);
    await tastoDestro(page, frame);
    await expect.poll(() => banca.dalMain('riquadro=1').length, { timeout: 15_000 }).toBeGreaterThan(0);
    const letture = banca.dalMain('riquadro=1');
    expect(letture.length).toBeGreaterThan(0);
    for (const v of letture) expect(nomi(v.cookie)).toEqual(['libero']);
  } finally { await banca.chiudi(); await annuncio.chiudi(); }
});

test('pagina ostile che incorpora il sito della banca: la foto della banca nel riquadro non porta la sessione', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const banca = await sito('127.0.0.1');
  const cdn = await sito('127.0.0.1');
  const ostile = await sito('localhost');
  try {
    // La foto sta su un'altra porta dello stesso sito: il riquadro non la può leggere da script e la scarica il main.
    const src = `${cdn.origine}/foto.png?incorporata=1`;
    banca.html = `<!doctype html><title>banca</title><img id="foto" src="${src}" width="50" height="50">`;
    ostile.html = `<!doctype html><title>ostile</title><iframe src="${banca.origine}/pagina" width="300" height="200"></iframe>`;
    const page = await openTab(`${ostile.origine}/pagina`);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await cookieSu(app, `${banca.origine}/`);
    const frame = page.frames().find((f) => f.url().startsWith(banca.origine));
    expect(frame).toBeTruthy();
    await frame.waitForFunction(() => document.getElementById('foto')?.complete);
    // Quello che manderebbe il riquadro stesso.
    await frame.evaluate((u) => new Promise((ok) => { const i = new Image(); i.onload = i.onerror = ok; i.src = u; }), src + '&dalriquadro=1');
    const delRiquadro = cdn.visti.find((v) => v.percorso.includes('dalriquadro'));
    expect(delRiquadro).toBeTruthy();
    await tastoDestro(page, frame);
    await expect.poll(() => cdn.dalMain('incorporata=1').length, { timeout: 15_000 }).toBeGreaterThan(0);
    const letture = cdn.dalMain('incorporata=1');
    expect(letture.length).toBeGreaterThan(0);
    for (const v of letture) expect(nomi(v.cookie)).toEqual(nomi(delRiquadro.cookie));
  } finally { await banca.chiudi(); await cdn.chiudi(); await ostile.chiudi(); }
});

test('immagine di un altro sito, nella pagina della banca, che rimanda alla banca: come la pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const banca = await sito('127.0.0.1');
  const evil = await sito('localhost');
  try {
    const src = `${evil.origine}/rimanda?a=${encodeURIComponent(`${banca.origine}/foto.png?giro=1`)}`;
    const page = await testServer.openReady(openTab, `<!doctype html><title>p</title><img id="foto" src="${src}" width="50" height="50">`);
    await cookieSu(app, `${banca.origine}/`);
    await page.evaluate((u) => new Promise((ok) => { const i = new Image(); i.onload = i.onerror = ok; i.src = u; }),
      `${evil.origine}/rimanda?a=${encodeURIComponent(`${banca.origine}/foto.png?pagina=1`)}`);
    const dellaPagina = banca.visti.find((v) => v.percorso.includes('pagina=1'));
    const host = new URL(page.url()).hostname;
    const r = await app.evaluate(async ({ BrowserWindow }, { host, code }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const t = w._filoTabs.tabs.find((x) => { try { return new URL(x.view.webContents.getURL()).hostname === host; } catch (_) { return false; } });
      return t.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }]);
    }, { host, code: `SN_ACTIONS.scaricaImmagine(${JSON.stringify(src)}, document.getElementById('foto')).then((d) => d.slice(0, 22), (e) => 'errore: ' + e.message)` });
    expect(r).toBe('data:image/png;base64,');
    for (const v of banca.dalMain('giro=1')) expect(nomi(v.cookie)).toEqual(nomi(dellaPagina.cookie));
  } finally { await banca.chiudi(); await evil.chiudi(); }
});
