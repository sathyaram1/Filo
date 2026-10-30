// #1272.4 — i file che Filo scarica da solo per una pagina (tasto destro su un'immagine, Copia e Salva immagine, Aiuto,
// icona della scheda) portano i cookie che il loro sito darebbe alla pagina: a un altro sito solo quelli SameSite=None,
// mai la sessione che il sito riserva alle visite partite da sé. La regola: tests/unit/perContoDellaScheda.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { nelMondoDiFilo } from './helpers/confirm.mjs';
import { paginaDellAiuto } from './helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// Il sito della foto: annota chi chiede cosa e con quali cookie; mai dalla cache, così ogni lettura arriva qui.
async function sitoFoto(host) {
  const visti = [];
  const s = createServer((req, res) => {
    visti.push({
      percorso: req.url, cookie: String(req.headers.cookie || ''),
      dest: String(req.headers['sec-fetch-dest'] || ''), modo: String(req.headers['sec-fetch-mode'] || ''),
    });
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
    res.end(PNG);
  });
  await new Promise((r) => s.listen(0, host, r));
  return {
    visti,
    origine: `http://${host}:${s.address().port}`,
    // Le richieste del main: niente destinazione e nessun CORS (la pagina chiede «image», lo script in modalità cors).
    dalMain: (percorso) => visti.filter((v) => v.percorso.startsWith(percorso) && v.dest === 'empty' && v.modo === 'no-cors'),
    chiudi: async () => { try { s.closeAllConnections(); } catch (_) {} await new Promise((r) => s.close(r)); },
  };
}

const nomi = (cookie) => cookie.split(';').map((c) => c.trim().split('=')[0]).filter(Boolean).sort();

// Un cookie per ogni promessa che un sito può fare: riservato a sé (strict), alle visite che partono da lui o lo aprono
// (lax), non detto (Chromium lo tratta da lax), concesso a tutti (none, che vuole secure).
async function cookieDelSito(app, paginaHost, url) {
  await app.evaluate(async ({ BrowserWindow }, { paginaHost, url }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => { try { return new URL(x.view.webContents.getURL()).host === paginaHost; } catch (_) { return false; } });
    const ses = t.view.webContents.session;
    await ses.cookies.set({ url, name: 'stretto', value: '1', sameSite: 'strict' });
    await ses.cookies.set({ url, name: 'medio', value: '1', sameSite: 'lax' });
    await ses.cookies.set({ url, name: 'nondetto', value: '1', sameSite: 'unspecified' });
    await ses.cookies.set({ url, name: 'libero', value: '1', sameSite: 'no_restriction', secure: true });
  }, { paginaHost, url });
}

// Quello che manda la pagina stessa ricaricando il file: il metro di Filo.
async function cookieDellaPagina(page, sito, percorso) {
  await page.evaluate((u) => new Promise((ok) => { const i = new Image(); i.onload = i.onerror = ok; i.src = u; }), `${sito.origine}${percorso}`);
  const v = sito.visti.find((x) => x.percorso === percorso && x.dest === 'image');
  expect(v, 'la pagina ha richiesto il file').toBeTruthy();
  return nomi(v.cookie);
}

test('la foto di un altro sito, letta da tasto destro, Copia, Salva e Aiuto, porta solo i cookie che quel sito concede alla pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  // localhost e 127.0.0.1 sono due siti diversi, come una banca e la pagina che ne mostra un'immagine.
  const sito = await sitoFoto('localhost');
  const src = `${sito.origine}/foto.png`;
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Articolo</title></head>
      <body style="padding:24px;font:16px sans-serif"><h1>Un articolo</h1>
      <img id="foto" src="${src}" width="160" height="160" alt="foto"></body></html>`);
    await page.waitForFunction(() => { const i = document.getElementById('foto'); return i.complete && i.naturalWidth > 0; });
    const paginaHost = new URL(page.url()).host;
    await cookieDelSito(app, paginaHost, `${sito.origine}/`);
    const dallaPagina = await cookieDellaPagina(page, sito, '/foto.png?la-pagina');
    expect(dallaPagina).toEqual(['libero']);

    // Tasto destro: descrizione e origine partono dai byte che scarica il main.
    await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    await expect.poll(() => sito.dalMain('/foto.png').length, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.keyboard.press('Escape');

    let prima = sito.dalMain('/foto.png').length;
    await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    const copia = menuDi(page).locator('.sn-menu button', { hasText: 'Copia immagine' });
    await expect(copia).toBeVisible();
    await copia.click();
    await expect.poll(() => sito.dalMain('/foto.png').length, { timeout: 15_000 }).toBeGreaterThan(prima);

    prima = sito.dalMain('/foto.png').length;
    await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    const salva = menuDi(page).locator('.sn-menu button', { hasText: 'Salva immagine come' });
    await expect(salva).toBeVisible();
    await salva.click();
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    await expect.poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 15_000 }).toContain('foto.png');
    expect(sito.dalMain('/foto.png').length).toBeGreaterThan(prima);

    prima = sito.dalMain('/foto.png').length;
    await nelMondoDiFilo(app, new URL(page.url()).hostname, 'SN_SIDEBAR.open(); 1');
    const aiuto = await paginaDellAiuto(app, page);
    await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
    await aiuto.fill('.sn-sidebar-input textarea', 'cosa mostra la foto?');
    await aiuto.press('.sn-sidebar-input textarea', 'Enter');
    await expect.poll(() => sito.dalMain('/foto.png').length, { timeout: 15_000 }).toBeGreaterThan(prima);

    // Ogni lettura di Filo ha portato al sito della foto quello che porta la pagina, e niente della sua sessione riservata.
    const letture = sito.dalMain('/foto.png');
    expect(letture.length).toBeGreaterThanOrEqual(4);
    expect(letture.map((v) => nomi(v.cookie))).toEqual(letture.map(() => dallaPagina));
  } finally {
    await sito.chiudi();
  }
});

test('la foto del sito della pagina, su un\'altra origine, porta tutti i cookie che porterebbe la pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  // Stesso sito della pagina, altra porta: lo script non la può leggere e la scarica il main.
  const sito = await sitoFoto('127.0.0.1');
  const src = `${sito.origine}/foto.png`;
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><title>p</title><img id="foto" src="${src}" width="160" height="160">`);
    await page.waitForFunction(() => { const i = document.getElementById('foto'); return i.complete && i.naturalWidth > 0; });
    const paginaHost = new URL(page.url()).host;
    await cookieDelSito(app, paginaHost, `${sito.origine}/`);
    const dallaPagina = await cookieDellaPagina(page, sito, '/foto.png?la-pagina');
    expect(dallaPagina).toEqual(['libero', 'medio', 'nondetto', 'stretto']);

    const letta = await nelMondoDiFilo(app, new URL(page.url()).hostname,
      `SN_ACTIONS.scaricaImmagine(${JSON.stringify(src + '?per-filo')}, document.getElementById('foto')).then((d) => d.slice(0, 22), (e) => 'errore: ' + e.message)`);
    expect(letta).toBe('data:image/png;base64,');
    const letture = sito.dalMain('/foto.png?per-filo');
    expect(letture.length).toBeGreaterThan(0);
    expect(letture.map((v) => nomi(v.cookie))).toEqual(letture.map(() => dallaPagina));
  } finally {
    await sito.chiudi();
  }
});

test('l\'icona della scheda porta i cookie solo se sta sul sito della pagina', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(60_000);
  const altroSito = await sitoFoto('localhost');
  const suoSito = await sitoFoto('127.0.0.1');
  try {
    const page = await testServer.openReady(openTab, '<!doctype html><title>Icone</title><p>icone</p>');
    const paginaHost = new URL(page.url()).host;
    await cookieDelSito(app, paginaHost, `${altroSito.origine}/`);
    await cookieDelSito(app, paginaHost, `${suoSito.origine}/`);
    const dichiara = (href) => page.evaluate((h) => {
      document.querySelectorAll('link[rel="icon"]').forEach((l) => l.remove());
      const l = document.createElement('link');
      l.rel = 'icon';
      l.href = h;
      document.head.appendChild(l);
    }, href);

    // Un'icona dichiarata su un altro sito (un indirizzo che con la sessione farebbe qualcosa) parte senza cookie…
    await dichiara(`${altroSito.origine}/icona.png?esci=1`);
    await expect.poll(() => altroSito.dalMain('/icona.png').length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(altroSito.dalMain('/icona.png').map((v) => v.cookie)).toEqual(altroSito.dalMain('/icona.png').map(() => ''));

    // …quella del sito della pagina arriva coi suoi cookie, e la scheda la mostra.
    await dichiara(`${suoSito.origine}/icona.png`);
    await expect.poll(() => suoSito.dalMain('/icona.png').length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(nomi(suoSito.dalMain('/icona.png')[0].cookie)).toEqual(['libero', 'medio', 'nondetto', 'stretto']);
    await expect.poll(() => shell.evaluate(() => [...document.querySelectorAll('.tab .favicon')]
      .some((f) => /^url\("data:image\/png;base64,/.test(f.style.backgroundImage || ''))), { timeout: 15_000 }).toBe(true);
  } finally {
    await altroSito.chiudi();
    await suoSito.chiudi();
  }
});
