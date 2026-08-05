// Feedback #400: «tasto destro su un video (o un audio) apre il menu di Filo ma
// dentro non c'è NIENTE che riguardi il video». Il menu di Filo prende il posto
// di quello di Chromium su tutte le pagine, quindi finché la matrice contestuale
// non aveva un ramo per <video>/<audio> l'utente perdeva OGNI azione sul media:
// salvarlo, copiarne l'indirizzo, finestra mobile, ripetizione, velocità.
//
// I test asseriscono il SUCCESSO delle azioni (il video va davvero in pausa, la
// velocità cambia davvero, il file finisce davvero su disco), non la presenza
// dell'etichetta: senza il ramo media il menu non ha le voci → rosso.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { readdirSync, existsSync } from 'node:fs';

// MP4 minimo (non riproducibile, ma serve solo come "file" da scaricare/linkare).
const MP4 = Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQ==', 'base64');

// WAV di silenzio (1s, 8kHz, 8 bit): un media che Chromium riproduce DAVVERO,
// necessario per verificare che "Pausa"/"Riproduci" agiscano sulla riproduzione.
function silentWav() {
  const sr = 8000;
  const n = sr; // 1 secondo
  const data = Buffer.alloc(n, 128);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34);
  h.write('data', 36); h.writeUInt32LE(n, 40);
  return Buffer.concat([h, data]);
}

// Serve un file binario su una porta propria (⇒ altra origine, come i CDN veri).
async function serveBinary(buffer, contentType) {
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': buffer.length });
    res.end(buffer);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    url: (name) => `http://127.0.0.1:${srv.address().port}/${name}`,
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

// Pagina con un <video> vero: niente sorgente decodificabile, ci interessa che
// l'elemento esista e risponda ai comandi (velocità, ripetizione, controlli).
function pageHtml(videoSrc) {
  return `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <h1>Articolo con filmato</h1>
    <video id="v" src="${videoSrc}" width="320" height="180" style="background:#333"></video>
    <audio id="a" src="${videoSrc}" controls style="display:block;width:300px"></audio>
    <p id="testo">Un paragrafo qualsiasi sotto al video.</p>
  </body></html>`;
}

async function openMenuOn(page, selector) {
  await page.locator(selector).click({ button: 'right', position: { x: 20, y: 20 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu;
}

test('tasto destro su un video: il menu offre le azioni del video', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pageHtml('/nonexistent.mp4'));

  const menu = await openMenuOn(page, '#v');
  await page.screenshot({ path: 'tests/.shots/context-menu-media.png' }).catch(() => {});

  // Prima del fix la zona contestuale su un video era VUOTA: solo Aiuto, Invia
  // feedback e Invia attacco.
  for (const label of ['Riproduci', 'Disattiva audio', 'Velocità', 'Ripeti in continuo', 'Mostra i controlli', 'Copia URL video', 'Salva video come']) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
});

test('Pausa e Riproduci agiscono davvero sulla riproduzione', async ({ openTab, testServer }) => {
  // Serve un media DECODIFICABILE: solo così `paused` racconta la verità.
  const media = await serveBinary(silentWav(), 'audio/wav');
  try {
    const src = media.url('suono.wav');
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
      <audio id="a" src="${src}" muted loop controls style="display:block;width:300px"></audio>
    </body></html>`);
    // `muted` perché la politica autoplay di Chromium blocca l'audio udibile
    // avviato senza un gesto dell'utente.
    await page.evaluate(() => document.getElementById('a').play().catch(() => {}));
    await expect.poll(() => page.evaluate(() => document.getElementById('a').paused)).toBe(false);

    let menu = await openMenuOn(page, '#a');
    await menu.locator('button', { hasText: 'Pausa' }).first().click();
    await expect.poll(() => page.evaluate(() => document.getElementById('a').paused)).toBe(true);

    // Invariante: la stessa voce ora propone (e fa) l'azione opposta.
    menu = await openMenuOn(page, '#a');
    await menu.locator('button', { hasText: 'Riproduci' }).first().click();
    await expect.poll(() => page.evaluate(() => document.getElementById('a').paused)).toBe(false);
  } finally {
    await media.close();
  }
});

test('la velocità si cambia davvero (clic accelera, il sotto-menu sceglie il valore esatto)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pageHtml('/nonexistent.mp4'));

  // Un clic sul corpo della voce accelera di uno scatto: 1× → 1,25×.
  let menu = await openMenuOn(page, '#v');
  await expect(menu.getByText('Velocità 1×')).toBeVisible();
  await menu.locator('button', { hasText: 'Velocità' }).first().click();
  await expect.poll(() => page.evaluate(() => document.getElementById('v').playbackRate)).toBe(1.25);

  // La freccetta apre l'elenco completo, rallentamenti inclusi: 0,5× si applica.
  menu = await openMenuOn(page, '#v');
  await expect(menu.getByText('Velocità 1,25×')).toBeVisible();
  await menu.locator('.sn-menu-split-arrow').first().hover();
  const sub = page.locator('.sn-menu-sub');
  await expect(sub).toBeVisible();
  await sub.locator('button', { hasText: '0,5×' }).first().click();
  await expect.poll(() => page.evaluate(() => document.getElementById('v').playbackRate)).toBe(0.5);
});

test('ripetizione e controlli si attivano davvero, e la voce racconta lo stato', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pageHtml('/nonexistent.mp4'));

  let menu = await openMenuOn(page, '#v');
  await menu.locator('button', { hasText: 'Ripeti in continuo' }).first().click();
  await expect.poll(() => page.evaluate(() => document.getElementById('v').loop)).toBe(true);

  // Invariante UX: se si può attivare, si deve poter disattivare — la voce ora
  // propone l'azione opposta.
  menu = await openMenuOn(page, '#v');
  await menu.locator('button', { hasText: 'Non ripetere' }).first().click();
  await expect.poll(() => page.evaluate(() => document.getElementById('v').loop)).toBe(false);

  menu = await openMenuOn(page, '#v');
  await menu.locator('button', { hasText: 'Mostra i controlli' }).first().click();
  await expect.poll(() => page.evaluate(() => document.getElementById('v').controls)).toBe(true);
  menu = await openMenuOn(page, '#v');
  await menu.locator('button', { hasText: 'Nascondi i controlli' }).first().click();
  await expect.poll(() => page.evaluate(() => document.getElementById('v').controls)).toBe(false);
});

test('tasto destro su un audio: le voci parlano di audio, non di video', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pageHtml('/nonexistent.mp4'));
  const menu = await openMenuOn(page, '#a');
  await expect(menu.getByText('Copia URL audio')).toBeVisible();
  await expect(menu.getByText('Salva audio come…')).toBeVisible();
  // La finestra mobile è roba da video: sull'audio non deve comparire.
  await expect(menu.getByText('Apri in finestra mobile')).toHaveCount(0);
});

test('il video coperto dai comandi del player resta raggiungibile col tasto destro', async ({ openTab, testServer }) => {
  // Scenario reale: il player mette un overlay sopra al filmato, quindi il tasto
  // destro NON arriva al <video> e non lo trova nemmeno fra gli antenati.
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <div id="player" style="position:relative;width:320px;height:180px">
      <video id="v" src="/nonexistent.mp4" style="position:absolute;inset:0;width:100%;height:100%;background:#333"></video>
      <div id="overlay" style="position:absolute;inset:0"></div>
    </div>
  </body></html>`);

  const menu = await openMenuOn(page, '#overlay');
  await expect(menu.getByText('Velocità 1×')).toBeVisible();
  await menu.locator('button', { hasText: 'Ripeti in continuo' }).first().click();
  await expect.poll(() => page.evaluate(() => document.getElementById('v').loop)).toBe(true);
});

test('un video di sfondo non ruba il menu al testo selezionato sopra di lui', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <video id="bg" src="/nonexistent.mp4" style="position:fixed;inset:0;width:100%;height:100%"></video>
    <p id="testo" style="position:relative;padding:60px;font:18px sans-serif">Una frase di prova abbastanza lunga da poter essere selezionata e spiegata.</p>
  </body></html>`);

  await page.evaluate(() => {
    const p = document.getElementById('testo');
    const r = document.createRange();
    r.selectNodeContents(p);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
  });
  const menu = await openMenuOn(page, '#testo');
  // Vince il contesto "testo selezionato": la spiegazione inline c'è…
  await expect(menu.locator('.sn-menu-inline')).toBeVisible();
  // …e le azioni del video non compaiono.
  await expect(menu.getByText('Velocità', { exact: false })).toHaveCount(0);
});

test('"Salva video come…" scarica davvero il file, anche da un altro dominio', async ({ app, openTab, testServer }) => {
  const mediaServer = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': MP4.length });
    res.end(MP4);
  });
  await new Promise((r) => mediaServer.listen(0, '127.0.0.1', r));
  const mediaUrl = `http://127.0.0.1:${mediaServer.address().port}/filmato.mp4`;

  try {
    const page = await testServer.openReady(openTab, pageHtml(mediaUrl));
    const pageUrl = page.url();

    const menu = await openMenuOn(page, '#v');
    const item = menu.locator('button', { hasText: 'Salva video come' });
    await expect(item).toBeVisible();
    await item.click();

    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    expect(dir).toBeTruthy();
    await expect
      .poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 15000 })
      .toContain('filmato.mp4');

    // La scheda non è navigata sull'URL del filmato e l'utente ha la conferma.
    expect(page.url()).toBe(pageUrl);
    await expect(page.locator('.sn-toast')).toContainText('Video salvato');
  } finally {
    try { mediaServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => mediaServer.close(r));
  }
});

test('"Copia URL video" mette negli appunti l\'indirizzo del filmato', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pageHtml('/filmato.mp4'));
  const expected = new URL('/filmato.mp4', page.url()).href;

  const menu = await openMenuOn(page, '#v');
  await menu.locator('button', { hasText: 'Copia URL video' }).first().click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
    .toBe(expected);
});
