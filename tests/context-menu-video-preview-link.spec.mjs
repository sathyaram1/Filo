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
//     ferma al confine del componente, quindi l'`<a>` in chiaro non si vedeva;
//   - collegamento e anteprima stanno IMPILATI dentro lo stesso componente, e
//     lì è `elementsFromPoint()` a fermarsi al bordo: di un componente
//     restituisce l'host, mai quello che c'è dentro;
//   - sopra tutto c'è un velo trasparente, e con l'anteprima FERMA lo stesso
//     identico pixel non dava più niente: né le voci della copertina né quelle
//     del collegamento. Bastava il velo, senza nemmeno un filmato.
//
// I test asseriscono il SUCCESSO dal punto di vista di chi guarda: le voci del
// collegamento ci sono ED eseguono l'azione sul collegamento («Copia URL» mette
// negli appunti l'href della scheda, non quello del filmato). Senza il fix le
// voci non esistono → il click non trova nulla → rosso. Gli ultimi due test
// tengono il confine: un filmato a tutta pagina con sotto un link che non
// c'entra niente, e un velo lontano dal collegamento, non devono regalare al
// menu le voci di quel link.

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

// Scheda-componente: collegamento e anteprima IMPILATI dentro lo stesso
// componente web, non annidati l'uno nell'altro. È la forma in cui la lamentela
// sopravviveva parola per parola: solo Riproduci/Velocità/Salva video come.
// `document.elementsFromPoint()` di un componente restituisce l'HOST, mai quello
// che c'è dentro, quindi la ricerca "cosa c'è sotto il cursore" si fermava al
// bordo del componente e il collegamento non lo vedeva più.
function stackedInComponentHtml(linkHref) {
  return `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <video-card></video-card>
    <script>
      class VideoCard extends HTMLElement {
        constructor() {
          super();
          this.attachShadow({ mode: 'open' }).innerHTML =
            '<div style="position:relative;width:320px;height:180px">'
            + '<a id="lnk" href="${linkHref}" style="position:absolute;inset:0;display:block"></a>'
            + '<video id="clip" src="/clip.mp4" style="position:absolute;inset:0;width:100%;height:100%;background:#333"></video>'
            + '</div>';
        }
      }
      customElements.define('video-card', VideoCard);
    </script>
  </body></html>`;
}

test('scheda-componente con link e anteprima impilati: le voci del collegamento ci sono', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, stackedInComponentHtml('https://example.com/scheda-impilata'));
  const menu = await openMenuOn(page, 'video-card');

  for (const label of MEDIA_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
});

test('scheda-componente impilata: "Copia URL" copia l\'indirizzo della scheda', async ({ app, openTab, testServer }) => {
  const linkHref = 'https://example.com/scheda-impilata-url';
  const page = await testServer.openReady(openTab, stackedInComponentHtml(linkHref));
  const menu = await openMenuOn(page, 'video-card');

  await menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'video' }).first().click();

  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
    .toBe(linkHref);
});

// Stessa scheda, anteprima FERMA. Il velo trasparente c'è ancora, sotto c'è la
// copertina e sotto ancora il collegamento: lo stesso identico pixel dava menu
// completo mentre il filmatino suonava e menu vuoto un istante dopo.
test('velo trasparente, anteprima ferma: il menu è quello della scheda, non vuoto', async ({ app, openTab, testServer }) => {
  const linkHref = 'https://example.com/scheda-ferma';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <div id="card" style="position:relative;width:320px;height:180px">
      <a id="lnk" href="${linkHref}" style="position:absolute;inset:0;display:block"></a>
      <img id="cover" src="${PX}" style="position:absolute;inset:0;width:100%;height:100%;background:#e07b39">
      <span id="velo" style="position:absolute;inset:0;background:rgba(0,0,0,.001)"></span>
    </div>
  </body></html>`);
  const menu = await openMenuOn(page, '#velo');
  await page.screenshot({ path: 'tests/.shots/context-menu-velo-anteprima-ferma.png' }).catch(() => {});

  await expect(menu.getByText('Salva immagine come', { exact: false }).first()).toBeVisible();
  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
  await menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'immagine' }).first().click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
    .toBe(linkHref);
});

// Non serve nemmeno una scheda video: un velo trasparente sopra un collegamento
// qualsiasi bastava a far sparire tutte e quattro le voci del link. È come sono
// costruiti quasi tutti gli elenchi di schede.
test('velo trasparente sopra un collegamento qualsiasi: le voci del link restano', async ({ app, openTab, testServer }) => {
  const linkHref = 'https://example.com/scheda-di-testo';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <div id="card" style="position:relative;width:320px;height:120px">
      <a id="lnk" href="${linkHref}" style="position:absolute;inset:0;display:block;background:#f0e6d8"></a>
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

// Il confine regge anche per il ripiego nuovo: sotto il cursore ci deve essere
// DAVVERO il collegamento, non uno che sta da un'altra parte nella pagina.
test('un velo lontano dal collegamento non si porta dietro le voci del link', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <a id="altrove" href="https://example.com/altro" style="position:absolute;left:20px;top:20px">Un collegamento qualsiasi</a>
    <span id="velo" style="position:absolute;left:20px;top:300px;width:320px;height:120px;background:rgba(0,0,0,.001)"></span>
  </body></html>`);
  const menu = await openMenuOn(page, '#velo');

  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: true })).toHaveCount(0);
  }
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

// ---------------------------------------------------------------------------
// Il freno: guardare sotto al punto cliccato vale SOLO per quello che l'utente
// sta guardando davvero. Senza questa parte basta un elemento opaco davanti
// perché il menu parli di roba invisibile: la barra fissa di un sito di notizie
// sotto cui sono scivolati i titoli, il riquadro dei cookie, un manto steso
// dalla pagina su tutta se stessa. In quest'ultimo caso il collegamento lo
// sceglie la PAGINA: «Copia URL» le mette in mano gli appunti, «Apri in nuova
// tab» e «Condividi link» decidono dove mandare l'utente, e a ogni clic destro
// parte l'analisi del link, che va a scaricare quell'indirizzo.
// ---------------------------------------------------------------------------

const IMG_LABELS = ['Copia immagine', 'Salva immagine come', 'Cerca immagine'];

async function expectNessunaVoceDelLink(menu) {
  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: true })).toHaveCount(0);
  }
  // E nemmeno l'analisi, che è la parte silenziosa. Compare «Analizzo il link…»
  // e Filo va a scaricare quell'indirizzo per conto suo.
  await expect(menu.getByText('Analizzo il link', { exact: false })).toHaveCount(0);
}

// Clic destro su coordinate assolute della pagina (non sul centro di un
// elemento): serve perché il punto è scelto su ciò che sta SOTTO alla barra.
async function rightClickAt(page, x, y) {
  await page.mouse.click(x, y, { button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu;
}

function notiziarioHtml() {
  const titoli = Array.from({ length: 40 }, (_, i) => (
    `<p style="margin:22px 0"><a id="t${i}" href="https://example.com/notizia-${i}">Notizia numero ${i}</a></p>`
  )).join('');
  return `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <header id="barra" style="position:fixed;left:0;right:0;top:0;height:64px;background:#123a8a;z-index:9"></header>
    <main style="padding:24px;padding-top:88px">${titoli}</main>
  </body></html>`;
}

test('barra fissa con i titoli scivolati sotto: il menu non adotta il collegamento nascosto', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, notiziarioHtml());
  // Scorro finché «Notizia numero 7» passa sotto la barra, poi punto la parte
  // vuota della barra proprio sopra di lui.
  const punto = await page.evaluate(() => {
    const a = document.getElementById('t7');
    window.scrollTo(0, Math.round(a.getBoundingClientRect().top + window.scrollY - 22));
    const r = a.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    return { x, y, bottom: r.bottom, sopra: document.elementFromPoint(x, y)?.id };
  });
  // Il titolo è davvero sepolto sotto la barra, e il clic arriva alla barra.
  expect(punto.bottom).toBeLessThan(64);
  expect(punto.sopra).toBe('barra');

  const menu = await rightClickAt(page, punto.x, punto.y);
  await expectNessunaVoceDelLink(menu);
});

test('barra fissa sopra un\'immagine: niente voci dell\'immagine che non si vede', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <header id="barra" style="position:fixed;left:0;right:0;top:0;height:64px;background:#123a8a;z-index:9"></header>
    <main style="padding:24px;padding-top:88px">
      <img id="foto" src="${PX}" style="display:block;width:220px;height:44px;background:#e07b39">
      <div style="height:1200px"></div>
    </main>
  </body></html>`);
  // Scorro finché la foto finisce per intero sotto la barra.
  const punto = await page.evaluate(() => {
    const img = document.getElementById('foto');
    window.scrollTo(0, Math.round(img.getBoundingClientRect().top + window.scrollY - 10));
    const r = img.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    return { x, y, sopra: document.elementFromPoint(x, y)?.id };
  });
  expect(punto.sopra).toBe('barra');

  const menu = await rightClickAt(page, punto.x, punto.y);
  for (const label of IMG_LABELS) {
    await expect(menu.getByText(label, { exact: false })).toHaveCount(0);
  }
});

test('riquadro dell\'avviso sopra un collegamento: le voci del link non vengono adottate', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <div style="height:200px">Una pagina qualsiasi.</div>
    <p style="margin:0"><a id="sepolto" href="https://example.com/notizia-sepolta">Notizia sepolta</a></p>
    <div id="avviso" style="position:fixed;left:0;right:0;top:140px;height:240px;background:#fffdf8;border:1px solid #333;z-index:9">
      Iscriviti alla newsletter
    </div>
  </body></html>`);
  const punto = await page.evaluate(() => {
    const r = document.getElementById('sepolto').getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    return { x, y, sopra: document.elementFromPoint(x, y)?.id };
  });
  expect(punto.sopra).toBe('avviso');

  const menu = await rightClickAt(page, punto.x, punto.y);
  await expectNessunaVoceDelLink(menu);
});

// Il caso peggiore: nessun link in vista, ma la pagina ne ha steso uno
// invisibile su tutta se stessa sotto al testo. Se il menu lo adottasse,
// l'indirizzo delle quattro voci lo sceglierebbe la pagina.
test('collegamento invisibile steso su tutta la pagina: il tasto destro sul testo non lo adotta', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <a id="manto" href="https://sito-che-decide.example/pagina-scelta-da-lui" style="position:absolute;inset:0;z-index:0"></a>
    <p id="testo" style="position:relative;z-index:1">Un paragrafo qualunque, senza nessun link in vista.</p>
  </body></html>`);
  const menu = await openMenuOn(page, '#testo');

  await expectNessunaVoceDelLink(menu);
});

// E il confine dall'altra parte: la sfumatura che regge il titolo copre solo il
// fondo della copertina, non tutta la scheda. Sta DENTRO l'ingombro della
// scheda, quindi è la stessa cosa che l'utente sta guardando e il menu resta
// quello della scheda intera.
test('sfumatura sul titolo (solo il fondo della copertina): il menu resta quello della scheda', async ({ app, openTab, testServer }) => {
  const linkHref = 'https://example.com/scheda-con-sfumatura';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <div id="card" style="position:relative;width:320px;height:180px">
      <a id="lnk" href="${linkHref}" style="position:absolute;inset:0;display:block"></a>
      <img id="cover" src="${PX}" style="position:absolute;inset:0;width:100%;height:100%;background:#e07b39">
      <span id="sfumatura" style="position:absolute;left:0;right:0;bottom:0;height:56px;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.75));color:#fff">Il titolo della scheda</span>
    </div>
  </body></html>`);
  const menu = await openMenuOn(page, '#sfumatura');

  await expect(menu.getByText('Salva immagine come', { exact: false }).first()).toBeVisible();
  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
  await menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'immagine' }).first().click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
    .toBe(linkHref);
});
