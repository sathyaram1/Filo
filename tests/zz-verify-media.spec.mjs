// VERIFIER (black-box) — feedback #400: «tasto destro su un video/audio: il menu
// non offre NIENTE sul video». Verifica indipendente: parto dal sintomo utente
// e asserisco l'EFFETTO (il filmato va davvero in pausa, la velocità cambia
// davvero, il file finisce davvero su disco), non l'etichetta.
//
// Nota sul materiale: niente ffmpeg in questo ambiente, quindi come sorgente
// riproducibile uso un WAV sintetizzato. Un <video src="...wav"> è comunque un
// HTMLVideoElement e riproduce davvero (readyState/paused reali), che è ciò che
// serve per verificare play/pausa/velocità/loop.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { readdirSync, existsSync } from 'node:fs';

// WAV PCM 8-bit mono, ~2 secondi, così play() ha davvero qualcosa da riprodurre.
function makeWav(seconds = 1) {
  const rate = 8000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write('data', 36); buf.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(60 * Math.sin(i / 12));
  return buf;
}
const WAV = makeWav(2);

// Server "media" su porta diversa dal testServer ⇒ cross-origin, come i CDN veri.
async function mediaServer(handler) {
  const srv = createServer(handler || ((req, res) => {
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': WAV.length });
    res.end(WAV);
  }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    url: (p) => `http://127.0.0.1:${srv.address().port}${p}`,
    async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); },
  };
}

const item = (page, text) => page.locator('.sn-menu button', { hasText: text }).first();
const menuText = async (page) => (await page.locator('.sn-menu').first().textContent()) || '';

async function openMenuOn(page, selector, pos) {
  await page.locator(selector).click({ button: 'right', ...(pos ? { position: pos } : {}) });
  await expect(page.locator('.sn-menu').first()).toBeVisible();
}

// ────────────────────────── 1. il sintomo del feedback ──────────────────────

test('il menu su un video offre le azioni chieste dal feedback (salva, copia indirizzo, PiP, ripeti, velocità)', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <h1>Articolo di giornale</h1>
      <video id="v" width="480" height="270" src="${ms.url('/clip.webm')}" style="background:#222"></video>
    </body></html>`);
    await openMenuOn(page, '#v', { x: 200, y: 120 });
    const t = await menuText(page);
    expect(t).toMatch(/Salva video/i);
    expect(t).toMatch(/Copia URL video/i);
    expect(t).toMatch(/finestra mobile/i);
    expect(t).toMatch(/Ripeti/i);
    expect(t).toMatch(/Velocità/i);
  } finally { await ms.close(); }
});

test('il menu su un audio offre le azioni equivalenti (e NON la finestra mobile)', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <audio id="a" controls src="${ms.url('/tone.wav')}"></audio>
    </body></html>`);
    await openMenuOn(page, '#a');
    const t = await menuText(page);
    expect(t).toMatch(/Salva audio/i);
    expect(t).toMatch(/Copia URL audio/i);
    expect(t).toMatch(/Ripeti/i);
    expect(t).toMatch(/Velocità/i);
    expect(t).not.toMatch(/finestra mobile/i);
  } finally { await ms.close(); }
});

// ───────────────────────── 2. gli EFFETTI, non le etichette ─────────────────

test('Riproduci/Pausa fa davvero partire e fermare il filmato', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <video id="v" width="400" height="220" src="${ms.url('/clip.webm')}"></video>
    </body></html>`);
    await page.waitForFunction(() => document.getElementById('v').readyState >= 2);
    expect(await page.evaluate(() => document.getElementById('v').paused)).toBe(true);

    await openMenuOn(page, '#v', { x: 180, y: 100 });
    await item(page, 'Riproduci').click();
    await expect.poll(() => page.evaluate(() => document.getElementById('v').paused)).toBe(false);

    await openMenuOn(page, '#v', { x: 180, y: 100 });
    expect(await menuText(page)).toMatch(/Pausa/);
    await item(page, 'Pausa').click();
    await expect.poll(() => page.evaluate(() => document.getElementById('v').paused)).toBe(true);
  } finally { await ms.close(); }
});

test('Disattiva/Riattiva audio cambia davvero lo stato muto', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <video id="v" width="400" height="220" src="${ms.url('/clip.webm')}"></video>
    </body></html>`);
    await openMenuOn(page, '#v', { x: 180, y: 100 });
    await item(page, 'Disattiva audio').click();
    await expect.poll(() => page.evaluate(() => document.getElementById('v').muted)).toBe(true);
    await openMenuOn(page, '#v', { x: 180, y: 100 });
    await item(page, 'Riattiva audio').click();
    await expect.poll(() => page.evaluate(() => document.getElementById('v').muted)).toBe(false);
  } finally { await ms.close(); }
});

test('la velocità cambia davvero: un clic accelera, il sottomenu permette di scegliere (e segna quella in corso)', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <video id="v" width="400" height="220" src="${ms.url('/clip.webm')}"></video>
    </body></html>`);
    const rate = () => page.evaluate(() => document.getElementById('v').playbackRate);

    await openMenuOn(page, '#v', { x: 180, y: 100 });
    await page.locator('.sn-menu .sn-menu-split-main', { hasText: 'Velocità' }).first().click();
    await expect.poll(rate).toBeGreaterThan(1);
    const afterOneClick = await rate();

    await openMenuOn(page, '#v', { x: 180, y: 100 });
    expect(await menuText(page)).toMatch(new RegExp(String(afterOneClick).replace('.', '[.,]')));

    await page.locator('.sn-menu .sn-menu-split-arrow').first().click();
    await page.waitForTimeout(300);
    await page.locator('.sn-menu button', { hasText: /0[.,]5\s*×/ }).last().click();
    await expect.poll(rate).toBe(0.5);

    await openMenuOn(page, '#v', { x: 180, y: 100 });
    await page.locator('.sn-menu .sn-menu-split-arrow').first().click();
    await page.waitForTimeout(300);
    const checked = await page.locator('.sn-menu button', { hasText: /0[.,]5\s*×/ }).last().textContent();
    expect(checked).toMatch(/[✓✔·•]/);
  } finally { await ms.close(); }
});

test('Ripeti in continuo accende e spegne davvero la ripetizione', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <video id="v" width="400" height="220" src="${ms.url('/clip.webm')}"></video>
    </body></html>`);
    await openMenuOn(page, '#v', { x: 180, y: 100 });
    await item(page, 'Ripeti in continuo').click();
    await expect.poll(() => page.evaluate(() => document.getElementById('v').loop)).toBe(true);
    await openMenuOn(page, '#v', { x: 180, y: 100 });
    expect(await menuText(page)).toMatch(/Non ripetere/);
    await item(page, 'Non ripetere').click();
    await expect.poll(() => page.evaluate(() => document.getElementById('v').loop)).toBe(false);
  } finally { await ms.close(); }
});

test('Mostra/Nascondi i controlli agisce davvero sui comandi del filmato', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <video id="v" width="400" height="220" src="${ms.url('/clip.webm')}"></video>
    </body></html>`);
    await openMenuOn(page, '#v', { x: 180, y: 100 });
    await item(page, 'Mostra i controlli').click();
    await expect.poll(() => page.evaluate(() => document.getElementById('v').controls)).toBe(true);
    await openMenuOn(page, '#v', { x: 180, y: 100 });
    await item(page, 'Nascondi i controlli').click();
    await expect.poll(() => page.evaluate(() => document.getElementById('v').controls)).toBe(false);
  } finally { await ms.close(); }
});

test('Copia URL video mette davvero negli appunti l\'indirizzo assoluto', async ({ app, openTab, testServer }) => {
  const ms = await mediaServer();
  const url = ms.url('/clip.webm');
  try {
    await app.evaluate(({ clipboard }) => clipboard.writeText('SEGNAPOSTO'));
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <video id="v" width="400" height="220" src="${url}"></video>
    </body></html>`);
    await openMenuOn(page, '#v', { x: 180, y: 100 });
    await item(page, 'Copia URL video').click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 }).toBe(url);
  } finally { await ms.close(); }
});

test('Salva video come… scarica davvero il file, anche da un dominio diverso, senza far navigare la scheda', async ({ app, openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <h1>Articolo</h1>
      <video id="v" width="400" height="220" src="${ms.url('/filmato.webm')}"></video>
    </body></html>`);
    const before = page.url();
    await openMenuOn(page, '#v', { x: 180, y: 100 });
    await item(page, 'Salva video come').click();

    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    await expect
      .poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 20000 })
      .toContain('filmato.webm');
    expect(page.url()).toBe(before);
  } finally { await ms.close(); }
});

// ─────────────── 3. il caso vero: il lettore che copre il filmato ───────────

test('il menu del video compare anche cliccando sopra i comandi di un lettore che copre il filmato', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px">
      <div id="player" style="position:relative;width:480px;height:270px;background:#000">
        <video id="v" width="480" height="270" src="${ms.url('/clip.webm')}" style="position:absolute;inset:0"></video>
        <div id="overlay" style="position:absolute;inset:0;background:rgba(0,0,0,.2)"></div>
      </div>
    </body></html>`);
    await openMenuOn(page, '#overlay', { x: 200, y: 130 });
    const t = await menuText(page);
    expect(t).toMatch(/Salva video/i);
    expect(t).toMatch(/Velocità/i);
    await item(page, 'Ripeti in continuo').click();
    await expect.poll(() => page.evaluate(() => document.getElementById('v').loop)).toBe(true);
  } finally { await ms.close(); }
});

test('un video di sfondo NON ruba il menu al testo selezionato sopra di lui', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
      <video id="bg" src="${ms.url('/clip.webm')}" style="position:fixed;inset:0;width:100%;height:100%;object-fit:cover"></video>
      <p id="p" style="position:relative;padding:60px;font:20px sans-serif">Frase lunga da selezionare e spiegare con Filo.</p>
    </body></html>`);
    await page.evaluate(() => {
      const r = document.createRange(); r.selectNodeContents(document.getElementById('p'));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await openMenuOn(page, '#p');
    await expect(page.locator('.sn-menu .sn-menu-inline')).toBeVisible();
    expect(await menuText(page)).not.toMatch(/Salva video/i);
  } finally { await ms.close(); }
});

test('un\'immagine sopra un video di sfondo mantiene il proprio menu (nessuna regressione)', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
      <video id="bg" src="${ms.url('/clip.webm')}" style="position:fixed;inset:0;width:100%;height:100%"></video>
      <img id="pic" style="position:relative;margin:60px;width:120px;height:80px;background:#8ab"
           src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==">
    </body></html>`);
    await openMenuOn(page, '#pic');
    const t = await menuText(page);
    expect(t).toMatch(/Salva immagine come/i);
    expect(t).not.toMatch(/Salva video/i);
  } finally { await ms.close(); }
});

// ───────────────────────────── 4. stress / limiti ───────────────────────────

test('video senza sorgente: il menu non offre salvataggi impossibili né rompe nulla', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
    <video id="v" width="400" height="220" style="background:#333"></video>
  </body></html>`);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await openMenuOn(page, '#v', { x: 180, y: 100 });
  const t = await menuText(page);
  expect(t.length).toBeGreaterThan(10);
  const save = page.locator('.sn-menu button', { hasText: /Salva video/i });
  if (await save.count()) {
    await save.first().click();
    await expect(page.locator('.sn-toast')).toBeVisible({ timeout: 8000 });
  }
  await page.waitForTimeout(300);
  expect(errs).toEqual([]);
});

test('video in streaming (MediaSource/blob): Filo spiega che non c\'è un file, non scarica spazzatura', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
    <video id="v" width="400" height="220"></video>
    <script>
      var ms = new MediaSource();
      document.getElementById('v').src = URL.createObjectURL(ms);
    </script>
  </body></html>`);
  await page.waitForFunction(() => (document.getElementById('v').src || '').startsWith('blob:'));
  await openMenuOn(page, '#v', { x: 180, y: 100 });
  const save = page.locator('.sn-menu button', { hasText: /Salva video/i });
  if (await save.count()) {
    await save.first().click();
    await expect(page.locator('.sn-toast')).toBeVisible({ timeout: 8000 });
  }
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  await page.waitForTimeout(1500);
  expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
});

test('URL del video lunghissimo (10.000 caratteri): il menu regge e non trabocca dallo schermo', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  const long = ms.url('/x.webm?q=' + 'a'.repeat(10000));
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <video id="v" width="400" height="220" src="${long}"></video>
    </body></html>`);
    await openMenuOn(page, '#v', { x: 180, y: 100 });
    const box = await page.locator('.sn-menu').first().boundingBox();
    const vw = await page.evaluate(() => window.innerWidth);
    expect(box.width).toBeLessThanOrEqual(vw);
  } finally { await ms.close(); }
});

test('URL con HTML dentro: nessuna iniezione nel menu (niente XSS)', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  const evil = ms.url('/%3Cimg%20src=x%20onerror=window.__pwned=1%3E.webm');
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <video id="v" width="400" height="220" src="${evil}"
             title="&lt;script&gt;window.__pwned=1&lt;/script&gt;"></video>
    </body></html>`);
    await openMenuOn(page, '#v', { x: 180, y: 100 });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.locator('.sn-menu img, .sn-menu script').count()).toBe(0);
  } finally { await ms.close(); }
});

test('sorgente javascript: — nessuna esecuzione, niente da copiare/scaricare', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }) => clipboard.writeText('SEGNAPOSTO'));
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
    <video id="v" width="400" height="220"></video>
    <script>document.getElementById('v').setAttribute('src','javascript:window.__pwned=1');</script>
  </body></html>`);
  await openMenuOn(page, '#v', { x: 180, y: 100 });
  const copy = page.locator('.sn-menu button', { hasText: /Copia URL video/i });
  if (await copy.count()) { await copy.first().click(); await page.waitForTimeout(600); }
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(clip.toLowerCase()).not.toContain('javascript:');
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

test('doppio clic destro rapido: resta un solo menu', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <video id="v" width="400" height="220" src="${ms.url('/clip.webm')}"></video>
    </body></html>`);
    await page.locator('#v').click({ button: 'right', position: { x: 100, y: 60 } });
    await page.locator('#v').click({ button: 'right', position: { x: 220, y: 140 } });
    await page.waitForTimeout(400);
    expect(await page.locator('.sn-menu').count()).toBe(1);
  } finally { await ms.close(); }
});

test('accelerare a ripetizione: la velocità gira in tondo senza incastrarsi', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <video id="v" width="400" height="220" src="${ms.url('/clip.webm')}"></video>
    </body></html>`);
    const seen = [];
    for (let i = 0; i < 8; i++) {
      await openMenuOn(page, '#v', { x: 180, y: 100 });
      await page.locator('.sn-menu .sn-menu-split-main', { hasText: 'Velocità' }).first().click();
      await page.waitForTimeout(150);
      seen.push(await page.evaluate(() => document.getElementById('v').playbackRate));
    }
    for (const r of seen) { expect(r).toBeGreaterThan(0); expect(r).toBeLessThanOrEqual(4); }
    expect(seen).toContain(1);
  } finally { await ms.close(); }
});

test('video con <source> figli (senza attributo src) è comunque coperto', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <video id="v" width="400" height="220"><source src="${ms.url('/dentro.webm')}" type="audio/wav"></video>
    </body></html>`);
    await page.waitForFunction(() => document.getElementById('v').currentSrc !== '');
    await openMenuOn(page, '#v', { x: 180, y: 100 });
    expect(await menuText(page)).toMatch(/Copia URL video|Salva video/i);
  } finally { await ms.close(); }
});

test('nessuna finestra mobile se il sito la vieta', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <video id="v" width="400" height="220" disablepictureinpicture src="${ms.url('/clip.webm')}"></video>
    </body></html>`);
    await openMenuOn(page, '#v', { x: 180, y: 100 });
    expect(await menuText(page)).not.toMatch(/finestra mobile/i);
  } finally { await ms.close(); }
});

test('traccia visiva del menu sopra il video', async ({ openTab, testServer }) => {
  const ms = await mediaServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif;background:#f6f2ea">
      <h1>Articolo con filmato</h1>
      <video id="v" width="520" height="292" src="${ms.url('/clip.webm')}" style="background:#222"></video>
    </body></html>`);
    await openMenuOn(page, '#v', { x: 160, y: 120 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/.shots/verify-400-menu-video.png' });
  } finally { await ms.close(); }
});
