// Feedback #437: «Copia URL copia anche indirizzi che non sono indirizzi».
//
// Un sito può mettere come sorgente di un'immagine/filmato — o come href di un
// link — qualcosa che non è un indirizzo: un frammento `javascript:`, un `data:`
// che contiene il file per esteso, testo qualsiasi. "Copia URL" lo copiava
// comunque: l'utente si ritrovava negli appunti una stringa che non apre niente
// da nessuna parte, e nulla glielo diceva. Per i filmati trasmessi a pezzi Filo
// diceva già la cosa giusta; qui lo stesso trattamento vale per tutti.
//
// I test asseriscono il COMPORTAMENTO, non il testo dell'avviso: gli appunti
// devono restare quelli di prima (un valore sentinella scritto dal test) e
// l'utente deve ricevere un avviso. Senza il fix la stringa finisce negli
// appunti → la sentinella sparisce → rosso.

import { test, expect } from './fixtures/electron.mjs';

const SENTINELLA = 'FILO-437-appunti-intatti';

// PNG 1×1: serve come contenuto di un'immagine `data:`, che è contenuto e non
// indirizzo.
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function pageHtml(body) {
  return `<!doctype html><html><body style="padding:24px;font:16px sans-serif">${body}</body></html>`;
}

async function seedClipboard(app) {
  await app.evaluate(({ clipboard }, testo) => clipboard.writeText(testo), SENTINELLA);
}

function readClipboard(app) {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

async function openMenuOn(page, selector) {
  await page.locator(selector).click({ button: 'right', position: { x: 8, y: 8 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu;
}

// Clicca la voce "Copia URL …" chiedendo l'etichetta esatta (le voci del link e
// quelle dell'immagine convivono nello stesso menu).
async function clickCopyUrl(menu, { exclude } = {}) {
  let item = menu.locator('button', { hasText: 'Copia URL' });
  if (exclude) item = item.filter({ hasNotText: exclude });
  await item.first().click();
}

test('#437 "Copia URL" su un link javascript: non riempie gli appunti e avvisa', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pageHtml(
    '<a id="finto" href="javascript:apriGalleria(42)">Guarda la galleria</a>',
  ));
  await seedClipboard(app);

  const menu = await openMenuOn(page, '#finto');
  await clickCopyUrl(menu, { exclude: 'immagine' });

  await expect(page.locator('.sn-toast')).toBeVisible();
  // Il cuore del fix: gli appunti dell'utente restano quelli di prima.
  await expect.poll(() => readClipboard(app), { timeout: 5000 }).toBe(SENTINELLA);
  // Traccia ispezionabile dell'avviso (non è il segnale primario).
  await page.screenshot({ path: 'tests/.shots/copy-url-not-an-address.png' }).catch(() => {});
});

test('#437 "Copia URL immagine" su una sorgente javascript: non riempie gli appunti e avvisa', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pageHtml(
    '<img id="rotta" src="javascript:caricaFoto()" width="120" height="120" style="background:#e07b39">',
  ));
  await seedClipboard(app);

  const menu = await openMenuOn(page, '#rotta');
  await clickCopyUrl(menu, {});

  await expect(page.locator('.sn-toast')).toBeVisible();
  await expect.poll(() => readClipboard(app), { timeout: 5000 }).toBe(SENTINELLA);
});

test('#437 "Copia URL immagine" su un data: non riempie gli appunti e avvisa', async ({ app, openTab, testServer }) => {
  // Un data: è il contenuto stesso, non un indirizzo: incollato altrove non
  // apre niente. Per avere l'immagine ci sono "Copia immagine" e "Salva come".
  const page = await testServer.openReady(openTab, pageHtml(
    `<img id="inline" src="${PX}" width="120" height="120" style="background:#e07b39">`,
  ));
  await seedClipboard(app);

  const menu = await openMenuOn(page, '#inline');
  await clickCopyUrl(menu, {});

  await expect(page.locator('.sn-toast')).toBeVisible();
  await expect.poll(() => readClipboard(app), { timeout: 5000 }).toBe(SENTINELLA);
});

test('#437 "Copia URL video" su una sorgente che non è un indirizzo non riempie gli appunti', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pageHtml(
    `<video id="v" src="${PX}" width="320" height="180" style="background:#333"></video>`,
  ));
  await seedClipboard(app);

  const menu = await openMenuOn(page, '#v');
  await menu.locator('button', { hasText: 'Copia URL video' }).first().click();

  await expect(page.locator('.sn-toast')).toBeVisible();
  await expect.poll(() => readClipboard(app), { timeout: 5000 }).toBe(SENTINELLA);
});

test('#437 "Condividi link" su un href che non è un indirizzo non riempie gli appunti', async ({ app, openTab, testServer }) => {
  // Senza sistema di condivisione nativo "Condividi link" ripiega sulla copia:
  // è lo stesso cammino, e deve dire la stessa cosa.
  const page = await testServer.openReady(openTab, pageHtml(
    '<a id="finto" href="javascript:condividi()">Condividi questo</a>',
  ));
  await seedClipboard(app);

  const menu = await openMenuOn(page, '#finto');
  await menu.locator('button', { hasText: 'Condividi link' }).first().click();

  await expect(page.locator('.sn-toast')).toBeVisible();
  await expect.poll(() => readClipboard(app), { timeout: 5000 }).toBe(SENTINELLA);
});

// ─── nessuna regressione: gli indirizzi veri si copiano come prima ───────────

test('#437 gli indirizzi veri finiscono ancora negli appunti', async ({ app, openTab, testServer }) => {
  const href = 'https://example.com/articolo-vero';
  const page = await testServer.openReady(openTab, pageHtml(
    `<a id="vero" href="${href}">Un collegamento vero</a>
     <img id="foto" src="/foto.png" width="120" height="120" style="background:#e07b39">`,
  ));
  const fotoUrl = new URL('/foto.png', page.url()).href;

  await seedClipboard(app);
  const menuLink = await openMenuOn(page, '#vero');
  await clickCopyUrl(menuLink, { exclude: 'immagine' });
  await expect.poll(() => readClipboard(app), { timeout: 8000 }).toBe(href);

  await seedClipboard(app);
  const menuImg = await openMenuOn(page, '#foto');
  await clickCopyUrl(menuImg, {});
  await expect.poll(() => readClipboard(app), { timeout: 8000 }).toBe(fotoUrl);
});
