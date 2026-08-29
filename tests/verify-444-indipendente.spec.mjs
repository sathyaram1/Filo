// VERIFICA INDIPENDENTE feedback #444 — spec scritto dal verificatore, da
// RIMUOVERE a fine verifica. Non fa parte del lavoro consegnato.
//
// Sintomo: sulle anteprime video dentro un collegamento (schede dei siti video
// e social) il tasto destro offriva solo i comandi del filmato, mai le voci del
// collegamento (Apri in nuova tab, Copia URL, Salva link per dopo, Condividi
// link). Deve valere in tutte le forme della scheda, SENZA adottare
// collegamenti che l'utente non sta guardando.

import { test, expect } from './fixtures/electron.mjs';

const LINK_LABELS = ['Apri in nuova tab', 'Salva link per dopo', 'Condividi link'];

async function rightClickAt(page, x, y) {
  await page.mouse.click(x, y, { button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu;
}

async function expectLinkItems(menu) {
  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
  // «Copia URL» del link, esatto (non «Copia URL video»).
  await expect(menu.locator('button', { hasText: /^Copia URL$/ }).first()).toBeVisible();
}

async function expectNoLinkItems(menu) {
  await expect(menu.getByText('Apri in nuova tab')).toHaveCount(0);
  await expect(menu.getByText('Salva link per dopo')).toHaveCount(0);
  await expect(menu.getByText('Condividi link')).toHaveCount(0);
}

// ---------------------------------------------------------------
// FORMA 1 — filmato ANNIDATO dentro il collegamento
// ---------------------------------------------------------------
test('video dentro <a>: il menu ha comandi filmato E voci collegamento', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <a id="card" href="https://esempio.test/watch?v=abc">
      <video id="v" src="/nope.mp4" width="320" height="180" style="display:block;background:#333"></video>
    </a>
  </body></html>`);

  const box = await page.locator('#v').boundingBox();
  const menu = await rightClickAt(page, box.x + box.width / 2, box.y + box.height / 2);
  await expect(menu.getByText('Velocità', { exact: false }).first()).toBeVisible();
  await expectLinkItems(menu);
});

// ---------------------------------------------------------------
// FORMA 2 — filmato STESO SOPRA la scheda (strati, non annidati)
// + azione vera: «Copia URL» copia l'indirizzo del collegamento
// ---------------------------------------------------------------
test('video steso sopra la scheda-link: voci collegamento presenti e Copia URL copia il link', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <div class="card" style="position:relative;width:320px;height:180px">
      <a id="lnk" href="https://esempio.test/scheda-strati" style="position:absolute;inset:0;z-index:1"></a>
      <video id="v" src="/nope.mp4" style="position:absolute;inset:0;width:100%;height:100%;background:#222;z-index:2"></video>
    </div>
  </body></html>`);

  const box = await page.locator('#v').boundingBox();
  const menu = await rightClickAt(page, box.x + 100, box.y + 80);
  await expect(menu.getByText('Velocità', { exact: false }).first()).toBeVisible();
  await expectLinkItems(menu);

  await menu.locator('button', { hasText: /^Copia URL$/ }).first().click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
    .toBe('https://esempio.test/scheda-strati');
});

// ---------------------------------------------------------------
// FORMA 3 — velo trasparente col titolo sopra il filmato, link sotto a tutto
// ---------------------------------------------------------------
test('velo trasparente sopra filmato e link: il clic sul velo dà filmato + collegamento', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <div class="card" style="position:relative;width:320px;height:180px">
      <a id="lnk" href="https://esempio.test/scheda-velo" style="position:absolute;inset:0;z-index:1"></a>
      <video id="v" src="/nope.mp4" style="position:absolute;inset:0;width:100%;height:100%;background:#222;z-index:2"></video>
      <div id="velo" style="position:absolute;inset:0;z-index:3;background:transparent"></div>
    </div>
  </body></html>`);

  const box = await page.locator('#velo').boundingBox();
  const menu = await rightClickAt(page, box.x + 60, box.y + 60);
  await expect(menu.getByText('Velocità', { exact: false }).first()).toBeVisible();
  await expectLinkItems(menu);
});

// ---------------------------------------------------------------
// FORMA 4 — filmato dentro un COMPONENTE WEB (shadow root) annidato nell'<a>
// ---------------------------------------------------------------
test('video dentro un componente web dentro il link: le voci del collegamento restano', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <a id="card" href="https://esempio.test/scheda-componente" style="display:block;width:320px;height:180px">
      <x-player id="xp" style="display:block;width:100%;height:100%"></x-player>
    </a>
    <script>
      customElements.define('x-player', class extends HTMLElement {
        connectedCallback() {
          const root = this.attachShadow({ mode: 'open' });
          root.innerHTML = '<video src="/nope.mp4" style="display:block;width:100%;height:100%;background:#333"></video>';
        }
      });
    </script>
  </body></html>`);

  const box = await page.locator('#xp').boundingBox();
  const menu = await rightClickAt(page, box.x + 100, box.y + 90);
  await expect(menu.getByText('Velocità', { exact: false }).first()).toBeVisible();
  await expectLinkItems(menu);
});

// ---------------------------------------------------------------
// FORMA 5 — stesso pixel, anteprima FERMA (copertina) e IN FUNZIONE (video)
// ---------------------------------------------------------------
const PIXEL_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

function cardHtml(inner) {
  return `<!doctype html><html><body style="margin:0;padding:24px">
    <div class="card" style="position:relative;width:320px;height:180px">
      <a id="lnk" href="https://esempio.test/scheda-anteprima" style="position:absolute;inset:0;z-index:1"></a>
      ${inner}
      <div id="velo" style="position:absolute;inset:0;z-index:3"></div>
    </div>
  </body></html>`;
}

test('anteprima ferma (copertina) sotto il velo: le voci del collegamento ci sono', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, cardHtml(
    `<img id="cover" src="${PIXEL_GIF}" style="position:absolute;inset:0;width:100%;height:100%;z-index:2">`,
  ));
  const box = await page.locator('#velo').boundingBox();
  const menu = await rightClickAt(page, box.x + 160, box.y + 90);
  await expectLinkItems(menu);
});

test('anteprima in funzione (video al posto della copertina), stesso pixel: stesse voci del collegamento', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, cardHtml(
    '<video id="v" src="/nope.mp4" style="position:absolute;inset:0;width:100%;height:100%;background:#222;z-index:2"></video>',
  ));
  const box = await page.locator('#velo').boundingBox();
  const menu = await rightClickAt(page, box.x + 160, box.y + 90);
  await expect(menu.getByText('Velocità', { exact: false }).first()).toBeVisible();
  await expectLinkItems(menu);
});

// ---------------------------------------------------------------
// NEGATIVI — il menu NON deve adottare collegamenti che l'utente non guarda
// ---------------------------------------------------------------
test('barra fissa opaca sopra un titolo-link scivolato sotto: niente voci del link sepolto', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <div id="bar" style="position:fixed;top:0;left:0;right:0;height:64px;background:#123;z-index:10"></div>
    <div style="height:2000px;padding-top:8px">
      <a id="buried" href="https://esempio.test/titolo-sepolto" style="display:block;font:20px sans-serif">Titolo scivolato sotto la barra</a>
    </div>
  </body></html>`);

  // Il titolo sta nei primi 64px, sotto la barra fissa.
  const menu = await rightClickAt(page, 200, 20);
  await expectNoLinkItems(menu);
});

test('riquadro cookie opaco sopra una scheda video+link: niente voci adottate da sotto', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <div class="card" style="position:relative;width:320px;height:180px">
      <a id="lnk" href="https://esempio.test/scheda-coperta" style="position:absolute;inset:0;z-index:1"></a>
      <video id="v" src="/nope.mp4" style="position:absolute;inset:0;width:100%;height:100%;background:#222;z-index:2"></video>
    </div>
    <div id="cookie" style="position:fixed;inset:0;background:rgba(255,255,255,0.98);z-index:100;font:16px sans-serif;padding:40px">
      Questo sito usa i cookie. Accetta o rifiuta.
    </div>
  </body></html>`);

  // Clic destro dentro l'area dove sotto ci sono video e link, ma davanti c'è il riquadro.
  const menu = await rightClickAt(page, 150, 120);
  await expectNoLinkItems(menu);
  await expect(menu.getByText('Velocità', { exact: false })).toHaveCount(0);
});

test('manto-link invisibile steso su tutta la pagina sotto il testo: il testo non porta le sue voci', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <a id="manto" href="https://esempio.test/manto-invisibile" style="position:absolute;inset:0;z-index:0"></a>
    <p id="testo" style="position:relative;z-index:1;padding:60px;font:18px sans-serif;background:#fff">
      Un paragrafo normale della pagina, senza nessun collegamento visibile.
    </p>
  </body></html>`);

  const box = await page.locator('#testo').boundingBox();
  const menu = await rightClickAt(page, box.x + 120, box.y + box.height / 2);
  await expectNoLinkItems(menu);
});

// ---------------------------------------------------------------
// STRESS — link «javascript:» dentro la scheda a strati: le voci non devono
// offrire di aprire/copiare un URL javascript come collegamento della scheda.
// (Almeno: il menu non esplode e le azioni restano coerenti.)
// ---------------------------------------------------------------
test('scheda a strati con link javascript: il menu si apre senza errori', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <div class="card" style="position:relative;width:320px;height:180px">
      <a id="lnk" href="javascript:alert(1)" style="position:absolute;inset:0;z-index:1"></a>
      <video id="v" src="/nope.mp4" style="position:absolute;inset:0;width:100%;height:100%;background:#222;z-index:2"></video>
    </div>
  </body></html>`);

  const box = await page.locator('#v').boundingBox();
  const menu = await rightClickAt(page, box.x + 100, box.y + 80);
  // I comandi del filmato ci sono comunque.
  await expect(menu.getByText('Velocità', { exact: false }).first()).toBeVisible();
});

// ---------------------------------------------------------------
// STRESS — aperture ripetute veloci sullo stesso punto: il menu resta uno e coerente
// ---------------------------------------------------------------
test('aperture ripetute rapide: un solo menu, voci del collegamento sempre presenti', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <div class="card" style="position:relative;width:320px;height:180px">
      <a id="lnk" href="https://esempio.test/ripetuto" style="position:absolute;inset:0;z-index:1"></a>
      <video id="v" src="/nope.mp4" style="position:absolute;inset:0;width:100%;height:100%;background:#222;z-index:2"></video>
    </div>
  </body></html>`);

  for (let i = 0; i < 3; i++) {
    await page.mouse.click(150, 120, { button: 'right' });
  }
  const menu = page.locator('.sn-menu');
  await expect(menu).toHaveCount(1);
  await expectLinkItems(menu);
});
