// VERIFICA INDIPENDENTE (verifier) — feedback #434.
// Sintomo dell'utente: tasto destro su un video/audio (o immagine) che sta DENTRO
// un collegamento → compaiono solo le azioni del media e le azioni del link
// spariscono del tutto (non si può aprire in nuova scheda, copiare l'indirizzo,
// salvare per dopo, condividere).
// Qui si asserisce il SUCCESSO: le due famiglie convivono e le voci del link
// agiscono davvero sul LINK.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

const MP4 = Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQ==', 'base64');
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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

async function openMenuOn(page, selector, pos = { x: 20, y: 20 }) {
  await page.locator(selector).click({ button: 'right', position: pos });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu;
}

const LINK_ITEMS = ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link'];

test('video dentro un link: compaiono sia le azioni del video sia quelle del collegamento', async ({ openTab, testServer }) => {
  const media = await serveBinary(MP4, 'video/mp4');
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
      <h1>Copertina di un articolo</h1>
      <a id="card" href="https://example.com/articolo"><video id="v" src="${media.url('clip.mp4')}" width="320" height="180" style="background:#333"></video></a>
    </body></html>`);
    const menu = await openMenuOn(page, '#v');
    await page.screenshot({ path: 'tests/.shots/verify-434-video-link.png' }).catch(() => {});

    // Famiglia media (deve restare).
    for (const label of ['Velocità', 'Ripeti in continuo', 'Salva video come', 'Copia URL video']) {
      await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
    }
    // Famiglia link (era quella che spariva).
    for (const label of LINK_ITEMS) {
      await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
    }
    // Le due famiglie devono essere separate da una riga, come chiedeva l'utente.
    await expect(menu.locator('.sn-menu-sep, hr, .sn-sep').first()).toBeVisible();
  } finally { await media.close(); }
});

test('"Copia URL" sul video dentro un link copia l\'indirizzo del COLLEGAMENTO', async ({ app, openTab, testServer }) => {
  const media = await serveBinary(MP4, 'video/mp4');
  const href = 'https://example.com/articolo-che-conta';
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
      <a id="card" href="${href}"><video id="v" src="${media.url('clip.mp4')}" width="320" height="180" style="background:#333"></video></a>
    </body></html>`);
    const menu = await openMenuOn(page, '#v');
    await menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'video' }).first().click();
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
      .toBe(href);
  } finally { await media.close(); }
});

test('audio dentro un link: entrambe le famiglie', async ({ openTab, testServer }) => {
  const media = await serveBinary(MP4, 'audio/mpeg');
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
      <a id="card" href="https://example.com/podcast"><audio id="a" src="${media.url('t.mp3')}" controls style="display:block;width:300px"></audio></a>
    </body></html>`);
    const menu = await openMenuOn(page, '#a', { x: 10, y: 10 });
    await expect(menu.getByText('Copia URL audio', { exact: false }).first()).toBeVisible();
    for (const label of LINK_ITEMS) {
      await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
    }
  } finally { await media.close(); }
});

test('il lettore che copre il filmato con i suoi comandi non fa sparire le azioni del video', async ({ openTab, testServer }) => {
  const media = await serveBinary(MP4, 'video/mp4');
  try {
    // Caso dei player veri: un overlay trasparente sopra il video, dentro il link.
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
      <a id="card" href="https://example.com/guarda" style="position:relative;display:inline-block">
        <video id="v" src="${media.url('clip.mp4')}" width="320" height="180" style="background:#333"></video>
        <div id="overlay" style="position:absolute;inset:0;background:rgba(0,0,0,.01)"></div>
      </a>
    </body></html>`);
    const menu = await openMenuOn(page, '#overlay', { x: 40, y: 40 });
    await page.screenshot({ path: 'tests/.shots/verify-434-overlay.png' }).catch(() => {});
    for (const label of ['Velocità', 'Salva video come']) {
      await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
    }
    for (const label of LINK_ITEMS) {
      await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
    }
  } finally { await media.close(); }
});

test('nessun falso positivo: un video FUORI da un link non mostra le azioni del collegamento', async ({ openTab, testServer }) => {
  const media = await serveBinary(MP4, 'video/mp4');
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
      <a id="altrove" href="https://example.com/altro">un link scollegato</a>
      <video id="v" src="${media.url('clip.mp4')}" width="320" height="180" style="background:#333"></video>
    </body></html>`);
    const menu = await openMenuOn(page, '#v');
    await expect(menu.getByText('Salva video come', { exact: false }).first()).toBeVisible();
    await expect(menu.getByText('Salva link per dopo', { exact: false })).toHaveCount(0);
    await expect(menu.getByText('Apri in nuova tab', { exact: false })).toHaveCount(0);
  } finally { await media.close(); }
});

test('stress: href javascript:, href lunghissimo, testo con <script>, clic destri ripetuti', async ({ app, openTab, testServer }) => {
  const media = await serveBinary(MP4, 'video/mp4');
  try {
    const lungo = `https://example.com/x?q=${'a'.repeat(10000)}`;
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
      <a id="js" href="javascript:window.__pwned=1"><video id="v1" src="${media.url('a.mp4')}" width="200" height="120" style="background:#333"></video></a>
      <a id="lungo" href="${lungo}"><video id="v2" src="${media.url('b.mp4')}" width="200" height="120" style="background:#444"></video></a>
      <a id="xss" href="https://example.com/ok?t=%3Cscript%3Ewindow.__xss=1%3C/script%3E&amp;e=%F0%9F%98%80"><img id="i3" src="${PX}" width="120" height="120" style="background:#e07b39"></a>
    </body></html>`);

    // 1) javascript: — il menu si apre e NON esegue lo script del link.
    let menu = await openMenuOn(page, '#v1', { x: 20, y: 20 });
    await expect(menu.getByText('Salva video come', { exact: false }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.__pwned || null)).toBe(null);

    // 2) href di 10.000 caratteri — il menu regge e "Copia URL" copia tutto.
    menu = await openMenuOn(page, '#v2', { x: 20, y: 20 });
    await menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'video' }).first().click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 }).toBe(lungo);

    // 3) testo/URL con <script> ed emoji — niente esecuzione nella pagina.
    menu = await openMenuOn(page, '#i3', { x: 8, y: 8 });
    await expect(menu.getByText('Copia immagine', { exact: false }).first()).toBeVisible();
    await expect(menu.getByText('Salva link per dopo', { exact: false }).first()).toBeVisible();
    expect(await page.evaluate(() => window.__xss || null)).toBe(null);
    await page.keyboard.press('Escape');

    // 4) clic destri rapidi in sequenza sullo stesso elemento: un solo menu, coerente.
    await page.locator('#v1').click({ button: 'right', position: { x: 20, y: 20 } });
    await page.locator('#v1').click({ button: 'right', position: { x: 30, y: 30 } });
    await page.locator('#v1').click({ button: 'right', position: { x: 40, y: 40 } });
    await expect(page.locator('.sn-menu')).toHaveCount(1);
    await expect(page.locator('.sn-menu').getByText('Salva video come', { exact: false }).first()).toBeVisible();
    await expect(page.locator('.sn-menu').getByText('Salva link per dopo', { exact: false }).first()).toBeVisible();
  } finally { await media.close(); }
});
