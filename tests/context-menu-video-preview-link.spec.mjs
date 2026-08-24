// Feedback #444: sulle home dei siti video e dei social, passando il mouse su una
// scheda parte un filmatino al posto della copertina — e in quel momento la
// scheda diventava irraggiungibile col tasto destro: il menu mostrava solo i
// comandi del filmato («Riproduci», «Velocità», «Salva video come»…) e NESSUNA
// voce del collegamento («Apri in nuova tab», «Copia URL», «Salva link per
// dopo», «Condividi link»). Per aprire la scheda in una nuova scheda bisognava
// spostare il mouse altrove e aspettare che l'anteprima smettesse.
//
// Il ramo media+link esisteva già (#434), ma riconosceva il collegamento SOLO
// come antenato del filmato. Nelle schede vere il collegamento sta altrove:
//   - l'anteprima è STESA SOPRA la scheda e il link le passa sotto (strati
//     sovrapposti, non annidati);
//   - il filmato vive dentro un componente web (shadow root) e `closest()` si
//     ferma al confine del componente, quindi l'`<a>` in chiaro non si vedeva.
//
// I test asseriscono il SUCCESSO dal punto di vista di chi guarda: le voci del
// collegamento ci sono ED eseguono l'azione sul collegamento («Copia URL» mette
// negli appunti l'href della scheda, non quello del filmato). Senza il fix le
// voci non esistono → il click non trova nulla → rosso. L'ultimo test tiene il
// confine: un filmato a tutta pagina con sotto un link che non c'entra niente
// non deve regalare al menu le voci di quel link.

import { test, expect } from './fixtures/electron.mjs';

const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const LINK_LABELS = ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link'];
const MEDIA_LABELS = ['Riproduci', 'Velocità', 'Salva video come'];

// La scheda come la fanno i siti veri: copertina + link della scheda, e
// l'anteprima video che al passaggio del mouse si stende SOPRA a tutto.
function overlayPreviewHtml(linkHref) {
  return `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <h1>Home con anteprime</h1>
    <div id="card" style="position:relative;width:320px;height:180px">
      <a id="lnk" href="${linkHref}" style="position:absolute;inset:0;display:block">
        <img id="cover" src="${PX}" style="width:100%;height:100%;background:#e07b39">
      </a>
      <video id="clip" src="/clip.mp4" style="position:absolute;inset:0;width:100%;height:100%;background:#333"></video>
    </div>
  </body></html>`;
}

async function openMenuOn(page, selector, position) {
  await page.locator(selector).click({ button: 'right', ...(position ? { position } : {}) });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu;
}

test('anteprima video stesa sopra la scheda: il menu tiene sia il filmato sia il collegamento', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, overlayPreviewHtml('https://example.com/scheda'));
  const menu = await openMenuOn(page, '#clip');
  await page.screenshot({ path: 'tests/.shots/context-menu-video-preview-link.png' }).catch(() => {});

  for (const label of MEDIA_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
});

test('"Copia URL" sull\'anteprima copia l\'indirizzo della SCHEDA, non quello del filmato', async ({ app, openTab, testServer }) => {
  const linkHref = 'https://example.com/scheda-di-prova';
  const page = await testServer.openReady(openTab, overlayPreviewHtml(linkHref));
  const menu = await openMenuOn(page, '#clip');

  await menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'video' }).first().click();

  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
    .toBe(linkHref);
});

test('filmato dentro un componente web, collegamento in chiaro: le voci del link restano', async ({ app, openTab, testServer }) => {
  const linkHref = 'https://example.com/scheda-componente';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <a id="card" href="${linkHref}"><video-preview></video-preview></a>
    <script>
      class VideoPreview extends HTMLElement {
        constructor() {
          super();
          this.attachShadow({ mode: 'open' }).innerHTML =
            '<video id="clip" src="/clip.mp4" width="320" height="180" style="background:#333"></video>';
        }
      }
      customElements.define('video-preview', VideoPreview);
    </script>
  </body></html>`);
  const menu = await openMenuOn(page, 'video-preview');

  for (const label of MEDIA_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
  await menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'video' }).first().click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
    .toBe(linkHref);
});

test('scheda a strati (velo sopra, filmato e link sotto): il menu è quello della scheda intera', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <div id="card" style="position:relative;width:320px;height:180px">
      <a id="lnk" href="https://example.com/scheda" style="position:absolute;inset:0;display:block"></a>
      <video id="clip" src="/clip.mp4" style="position:absolute;inset:0;width:100%;height:100%;background:#333"></video>
      <span id="velo" style="position:absolute;inset:0;background:rgba(0,0,0,.001)"></span>
    </div>
  </body></html>`);
  const menu = await openMenuOn(page, '#velo');

  for (const label of MEDIA_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
});

test('copertina stesa sopra il link (immagine, non filmato): stesse due famiglie di voci', async ({ app, openTab, testServer }) => {
  const linkHref = 'https://example.com/scheda-immagine';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <div id="card" style="position:relative;width:320px;height:180px">
      <a id="lnk" href="${linkHref}" style="position:absolute;inset:0;display:block"></a>
      <img id="cover" src="${PX}" style="position:absolute;inset:0;width:100%;height:100%;background:#e07b39">
    </div>
  </body></html>`);
  const menu = await openMenuOn(page, '#cover');

  await expect(menu.getByText('Salva immagine come', { exact: false }).first()).toBeVisible();
  await menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'immagine' }).first().click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
    .toBe(linkHref);
});

test('scheda tutta dentro un componente web (link e anteprima impilati lì dentro): le voci del link ci sono', async ({ app, openTab, testServer }) => {
  // La forma che restava scoperta: il collegamento NON avvolge il componente, sta
  // dentro insieme all'anteprima. `document.elementsFromPoint` si ferma al bordo
  // del componente e restituisce solo l'host, quindi la ricerca «cosa c'è sotto
  // il cursore» non vedeva più il collegamento e il menu tornava quello della
  // lamentela: solo i comandi del filmato.
  const linkHref = 'https://example.com/scheda-tutta-dentro';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <card-tile></card-tile>
    <script>
      class CardTile extends HTMLElement {
        constructor() {
          super();
          this.attachShadow({ mode: 'open' }).innerHTML =
            '<div style="position:relative;width:320px;height:180px">'
            + '<a href="${linkHref}" style="position:absolute;inset:0;display:block"></a>'
            + '<video src="/clip.mp4" style="position:absolute;inset:0;width:100%;height:100%;background:#333"></video>'
            + '</div>';
        }
      }
      customElements.define('card-tile', CardTile);
    </script>
  </body></html>`);
  const menu = await openMenuOn(page, 'card-tile');

  for (const label of MEDIA_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
  await menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'video' }).first().click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
    .toBe(linkHref);
});

test('stesso pixel, anteprima ferma: il menu della scheda resta (copertina + collegamento)', async ({ app, openTab, testServer }) => {
  // Prima: menu pieno mentre il filmatino suonava, menu VUOTO un istante dopo che
  // si era fermato — stessa scheda, stesso gesto, due esiti opposti.
  const linkHref = 'https://example.com/scheda-ferma';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <div id="card" style="position:relative;width:320px;height:180px">
      <a id="lnk" href="${linkHref}" style="position:absolute;inset:0;display:block"></a>
      <img id="cover" src="${PX}" style="position:absolute;inset:0;width:100%;height:100%;background:#e07b39">
      <video id="clip" src="/clip.mp4" style="position:absolute;inset:0;width:100%;height:100%;background:#333"></video>
      <span id="velo" style="position:absolute;inset:0;background:rgba(0,0,0,.001)"></span>
    </div>
  </body></html>`);

  // Anteprima in funzione.
  let menu = await openMenuOn(page, '#velo');
  await expect(menu.getByText('Salva video come', { exact: false }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  // L'anteprima smette e lascia il posto alla copertina: stesso pixel.
  await page.evaluate(() => document.getElementById('clip').remove());
  menu = await openMenuOn(page, '#velo');
  await expect(menu.getByText('Salva immagine come', { exact: false }).first()).toBeVisible();
  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
  await menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'immagine' }).first().click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
    .toBe(linkHref);
});

test('velo trasparente su un collegamento qualsiasi (niente filmato, niente copertina): le voci del link ci sono', async ({ app, openTab, testServer }) => {
  // Non è un problema delle sole schede video: qualunque elenco costruito a
  // strati copre le sue righe con un velo, e il tasto destro non trovava niente.
  const linkHref = 'https://example.com/riga-elenco';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <div id="riga" style="position:relative;width:320px;height:64px">
      <a id="lnk" href="${linkHref}" style="position:absolute;inset:0;display:block">Una riga dell'elenco</a>
      <span id="velo" style="position:absolute;inset:0;background:rgba(0,0,0,.001)"></span>
    </div>
  </body></html>`);
  const menu = await openMenuOn(page, '#velo');

  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
  await menu.locator('button', { hasText: 'Copia URL' }).first().click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
    .toBe(linkHref);
});

test('un filmato a tutta pagina non si porta dietro le voci di un link che gli passa sotto per caso', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <a id="estraneo" href="https://example.com/altro" style="position:fixed;left:40px;top:40px;z-index:1">Un collegamento qualsiasi</a>
    <video id="pieno" src="/clip.mp4" style="position:fixed;inset:0;width:100%;height:100%;z-index:2;background:#222"></video>
  </body></html>`);
  // Il clic destro cade sul filmato, proprio sopra al link che gli sta sotto.
  const menu = await openMenuOn(page, '#pieno', { x: 60, y: 48 });

  await expect(menu.getByText('Salva video come', { exact: false }).first()).toBeVisible();
  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: true })).toHaveCount(0);
  }
});
