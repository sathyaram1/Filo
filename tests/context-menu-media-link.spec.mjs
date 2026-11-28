// Feedback #434: quando un filmato (o un audio) sta DENTRO un collegamento — la
// copertina di un video in una lista, l'anteprima di un articolo, la miniatura
// che porta alla pagina intera — il tasto destro mostrava solo le azioni sul
// media e PERDEVA quelle sul link («Apri in nuova tab», «Copia URL», «Salva link
// per dopo», «Condividi link»): il ramo media di buildContextualItems ritornava
// prima che venisse valutato quello del link. Il ramo immagine era già stato
// sistemato (#401); qui si chiude la stessa lacuna per video/audio, incluso il
// caso in cui il player copre il filmato col proprio overlay (il <video> non è
// fra gli antenati del punto cliccato, ma sta dentro il link).
//
// I test asseriscono il SUCCESSO: le voci del link ci sono ED eseguono davvero
// l'azione sul collegamento («Copia URL» mette negli appunti l'href del link, non
// quello del filmato). Senza il fix la voce non esiste → il click fallisce → rosso.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

// Pagina-tipo: la scheda di un video in una lista (il <video> è dentro l'<a>).
function cardHtml(linkHref) {
  return `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <h1>Lista di video</h1>
    <a id="card" href="${linkHref}"><video id="clip" src="/clip.mp4" width="320" height="180" style="background:#333"></video></a>
    <a id="audiocard" href="${linkHref}/podcast"><audio id="pod" src="/pod.mp3" controls style="display:block;width:300px"></audio></a>
    <p id="testo">Un paragrafo sotto la scheda.</p>
  </body></html>`;
}

// Stessa scheda, ma con l'overlay del player sopra al filmato: è così che si
// comportano quasi tutti i player veri, e il clic destro arriva all'overlay.
function overlayCardHtml(linkHref) {
  return `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <a id="card" href="${linkHref}" style="position:relative;display:inline-block;width:320px;height:180px">
      <video id="clip" src="/clip.mp4" width="320" height="180" style="background:#333"></video>
      <span id="overlay" style="position:absolute;inset:0;background:rgba(0,0,0,.15)"></span>
    </a>
    <p id="testo">Un paragrafo sotto la scheda.</p>
  </body></html>`;
}

async function openMenuOn(page, selector, position = { x: 20, y: 20 }) {
  await page.locator(selector).click({ button: 'right', position });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu;
}

const LINK_LABELS = ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link'];

// A icone (#2555): «Copia URL» del collegamento è l'icona Copia, o una sua variante se il clic copia il filmato.
async function copiaUrlDelLink(page) {
  const m = menuDi(page);
  const icona = m.icona('copy').first();
  if (/^Copia URL$/.test(String(await icona.getAttribute('aria-label')).trim())) return m.scegli(icona);
  return m.variante(icona, /^\s*Copia URL\s*$/);
}

test('tasto destro su un video dentro un link: compaiono sia le azioni del video sia quelle del link', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, cardHtml('https://example.com/articolo'));
  await openMenuOn(page, '#clip');
  await page.screenshot({ path: 'tests/.shots/context-menu-media-link.png' }).catch(() => {});

  // A icone (#2555): un'icona della griglia, dietro il «+» o variante nel menu di un'icona.
  const m = menuDi(page);
  // Famiglia media (era già presente), poi quella del link (prima del fix spariva del tutto).
  for (const label of ['Riproduci', 'Velocità', 'Ripeti in continuo', 'Copia URL video', 'Salva video come', ...LINK_LABELS]) {
    expect(await m.haVoce(label), label).toBe(true);
  }
});

test('tasto destro su un audio dentro un link: le azioni del collegamento restano raggiungibili', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, cardHtml('https://example.com/serie'));
  await openMenuOn(page, '#pod');
  const m = menuDi(page);
  for (const label of ['Copia URL audio', ...LINK_LABELS]) expect(await m.haVoce(label), label).toBe(true);
});

test('"Copia URL" su un video-link copia l\'href del COLLEGAMENTO, non quello del filmato', async ({ app, openTab, testServer }) => {
  const linkHref = 'https://example.com/video-di-prova';
  const page = await testServer.openReady(openTab, cardHtml(linkHref));
  await openMenuOn(page, '#clip');

  // Prima del fix questa voce non esisteva sul menu di un video-link → il click
  // non troverebbe nulla e il test fallirebbe.
  await copiaUrlDelLink(page);

  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
    .toBe(linkHref);
});

test('le azioni del video funzionano ancora: "Ripeti in continuo" agisce davvero sul filmato', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, cardHtml('https://example.com/articolo'));
  await openMenuOn(page, '#clip');

  expect(await page.locator('#clip').evaluate((v) => v.loop)).toBe(false);
  await menuDi(page).scegli('Ripeti in continuo');
  await expect.poll(() => page.locator('#clip').evaluate((v) => v.loop)).toBe(true);
});

test('player con overlay: il video sotto e il link intorno convivono nello stesso menu', async ({ app, openTab, testServer }) => {
  const linkHref = 'https://example.com/video-con-overlay';
  const page = await testServer.openReady(openTab, overlayCardHtml(linkHref));
  await openMenuOn(page, '#overlay');

  // Il filmato è coperto dall'overlay: prima del fix il ramo link vinceva e le
  // azioni sul video sparivano.
  for (const label of ['Riproduci', 'Velocità', 'Salva video come']) expect(await menuDi(page).haVoce(label), label).toBe(true);
  // E le azioni del collegamento restano.
  await copiaUrlDelLink(page);
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
    .toBe(linkHref);
});

test('un video di sfondo NON si intrufola nel menu di un link che non lo contiene', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <video id="bg" src="/bg.mp4" style="position:fixed;inset:0;width:100%;height:100%;z-index:-1;background:#222"></video>
    <a id="plain" href="https://example.com/pagina" style="position:relative;z-index:1;display:inline-block;margin:40px">Un collegamento qualsiasi</a>
  </body></html>`);
  await openMenuOn(page, '#plain', { x: 20, y: 8 });
  const m = menuDi(page);
  for (const label of LINK_LABELS) expect(await m.haVoce(label), label).toBe(true);
  expect(await m.haVoce('Salva video come')).toBe(false);
  expect(await m.haVoce('Ripeti in continuo')).toBe(false);
});
