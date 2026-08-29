// Il freno del ripescaggio: i collegamenti SEPOLTI non entrano nel menu.
//
// La verifica avversariale del 29/08 ha aperto quattro porte nel freno
// geometrico del #444: bastava che l'elemento opaco davanti e il collegamento
// sepolto condividessero un bordo — la forma normale di barre e righe a tutta
// larghezza — perché il menu adottasse un link che l'utente non stava
// guardando, e con lui partisse l'analisi automatica dell'indirizzo scelto
// dalla pagina. Quinta porta, dal #499: il collegamento trasparente e inerte
// ai click, ritagliato sull'ingombro di un paragrafo.
//
// Ogni test asserisce il RIFIUTO dal punto di vista di chi guarda: il menu si
// apre (è il menu della pagina) ma le voci del collegamento sepolto non ci
// sono. Senza il fix le voci compaiono → rosso.
//
// Il confine dall'altra parte lo tengono i test di
// context-menu-video-preview-link.spec.mjs: le schede vere (anteprima stesa
// sopra, velo, componenti) devono CONTINUARE ad adottare il loro collegamento.

import { test, expect } from './fixtures/electron.mjs';

const LINK_LABELS = ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link'];

async function openMenuOn(page, selector, position) {
  await page.locator(selector).click({ button: 'right', ...(position ? { position } : {}) });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu;
}

async function expectNoLinkEntries(menu) {
  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: false })).toHaveCount(0);
  }
}

test('porta 1: barra fissa opaca sopra una riga-titolo a tutta larghezza — niente voci del titolo sepolto', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <div id="bar" style="position:fixed;top:0;left:0;right:0;height:64px;background:#1a3c6e;color:#fff;z-index:10">La barra del sito</div>
    <div style="height:20px"></div>
    <p style="margin:0"><a id="buried" href="https://attacker.example/scelto-dalla-pagina" style="display:block;width:100%;padding:12px 0">Titolo scivolato sotto la barra</a></p>
    <p style="margin-top:600px">Fondo pagina</p>
  </body></html>`);
  const menu = await openMenuOn(page, '#bar', { x: 200, y: 40 });
  await expectNoLinkEntries(menu);
});

test('porta 2: titolo centrato per metà sotto la barra dopo lo scroll — niente voci adottate', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <div id="bar" style="position:fixed;top:0;left:0;right:0;height:56px;background:#333;color:#fff;z-index:10">Barra fissa</div>
    <div style="height:300px"></div>
    <h2 style="text-align:center;margin:0"><a id="buried" href="https://attacker.example/titolo">Un titolo centrato di poche parole</a></h2>
    <p style="margin-top:1200px">Fondo</p>
  </body></html>`);
  // Scorri finché il titolo finisce per metà sotto la barra.
  await page.evaluate(() => {
    const a = document.getElementById('buried');
    const r = a.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + r.top - 28);
  });
  const box = await page.locator('#buried').boundingBox();
  const menu = await openMenuOn(page, '#bar', { x: Math.round(box.x + box.width / 2), y: 40 });
  await expectNoLinkEntries(menu);
});

test('porta 3: striscia dei cookie in basso sopra una riga-collegamento — niente voci', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <div style="height:40vh"></div>
    <p style="margin:0"><a id="buried" href="https://attacker.example/cookie-row" style="display:block;width:100%;padding:10px 0">Riga di collegamento a tutta larghezza in fondo</a></p>
    <div id="cookies" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#f4e9d8;border-top:1px solid #caa;z-index:10;padding:8px">Questo sito usa i cookie.</div>
    <script>
      // Porta la riga sotto la striscia dei cookie.
      const a = document.getElementById('buried');
      const c = document.getElementById('cookies');
      const dy = c.getBoundingClientRect().top + 30 - a.getBoundingClientRect().top;
      a.parentElement.style.transform = 'translateY(' + dy + 'px)';
    </script>
  </body></html>`);
  const menu = await openMenuOn(page, '#cookies', { x: 250, y: 40 });
  await expectNoLinkEntries(menu);
});

test('porta 4: collegamento invisibile steso su tutta la pagina sotto testo a filo bordo — niente voci, niente analisi', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <a id="mantle" href="https://attacker.example/manto" style="position:absolute;inset:0;display:block;z-index:0"></a>
    <p id="testo" style="position:relative;z-index:1;margin:0;padding:0;width:100%">Un paragrafo di testo normale che parte esattamente dal bordo della pagina e la occupa per tutta la larghezza, come i paragrafi veri.</p>
  </body></html>`);
  const menu = await openMenuOn(page, '#testo');
  await expectNoLinkEntries(menu);
});

test('porta 6: striscia dei cookie fissa sopra una riga-collegamento anch\'essa fissa — niente voci', async ({ openTab, testServer }) => {
  // Il secondo giro di verifica è entrato da qui: con TUTTI E DUE gli elementi
  // fissi il confine di fissità non distingue niente, decide la copertura.
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <p>Contenuto della pagina.</p>
    <a id="buried" href="https://attacker.example/riga-fissa" style="position:fixed;bottom:0;left:0;right:0;height:96px;display:block;z-index:5">Riga di collegamento fissata in fondo</a>
    <div id="cookies" style="position:fixed;bottom:0;left:0;right:0;height:96px;background:#f4e9d8;z-index:6;padding:8px">Questo sito usa i cookie.</div>
  </body></html>`);
  const menu = await openMenuOn(page, '#cookies', { x: 250, y: 48 });
  await expectNoLinkEntries(menu);
});

test('porta 7: pannello opaco su MEZZA scheda-collegamento — la parte coperta rifiuta, quella scoperta adotta', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <div style="position:relative;width:400px;height:200px">
      <a id="card" href="https://example.com/scheda-mezza" style="position:absolute;inset:0;display:block">Scheda con testo visibile nella metà scoperta</a>
      <div id="panel" style="position:absolute;top:0;left:0;width:400px;height:100px;background:#7a2c2c;color:#fff;z-index:2">Pannello opaco sulla metà alta</div>
    </div>
  </body></html>`);
  // Metà coperta: click sul pannello.
  const menuCoperta = await openMenuOn(page, '#panel', { x: 200, y: 50 });
  await expectNoLinkEntries(menuCoperta);
  await page.keyboard.press('Escape');
  // Metà scoperta: le voci del collegamento ci sono, giustamente.
  const menuScoperta = await openMenuOn(page, '#card', { x: 200, y: 160 });
  await expect(menuScoperta.getByText('Copia URL', { exact: false }).first()).toBeVisible();
});

test('porta 8: pannello opaco sull\'ingombro esatto di una scheda video-collegamento — niente voci del sepolto', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <div style="position:relative;width:320px;height:180px">
      <a id="card" href="https://attacker.example/scheda-nascosta" style="position:absolute;inset:0;display:block">
        <video id="clip" src="/clip.mp4" style="width:100%;height:100%;background:#333"></video>
      </a>
      <div id="panel" style="position:absolute;inset:0;background:#2c4a7a;color:#fff;z-index:3">Un pannello che copre tutta la scheda</div>
    </div>
  </body></html>`);
  const menu = await openMenuOn(page, '#panel');
  await expectNoLinkEntries(menu);
});

test('porta 9: pannello opaco assoluto sopra un collegamento normale in flusso — niente voci', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <p><a id="buried" href="https://attacker.example/sotto-il-velo" style="display:inline-block;padding:8px 0">Un collegamento normale della pagina</a></p>
    <div id="panel" style="position:absolute;background:#444;color:#fff;z-index:4;padding:6px">Riquadro promozionale opaco</div>
    <script>
      const a = document.getElementById('buried');
      const r = a.getBoundingClientRect();
      const p = document.getElementById('panel');
      p.style.left = (r.left - 4) + 'px'; p.style.top = (r.top - 4) + 'px';
      p.style.width = (r.width + 8) + 'px'; p.style.height = (r.height + 8) + 'px';
    </script>
  </body></html>`);
  const menu = await openMenuOn(page, '#panel');
  await expectNoLinkEntries(menu);
});

// ── Controprove: il velo SFUMATO è un velo, non una copertura ───────────────
// Terzo giro di verifica: trattare i gradienti come coperture opache spegneva
// le voci della scheda proprio sulla sua forma più comune. Attraverso la parte
// trasparente della sfumatura la scheda si vede: il menu resta completo.

const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const SCRIM = 'background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.75))';

test('controprova: scheda a strati con velo sfumato in cima — il menu resta completo (link e filmato)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <div id="card" style="position:relative;width:320px;height:180px">
      <a id="lnk" href="https://example.com/scheda-scrim" style="position:absolute;inset:0;display:block"></a>
      <video id="clip" src="/clip.mp4" style="position:absolute;inset:0;width:100%;height:100%;background:#333"></video>
      <span id="scrim" style="position:absolute;inset:0;${SCRIM};color:#fff;display:flex;align-items:flex-end">Il titolo</span>
    </div>
  </body></html>`);
  const menu = await openMenuOn(page, '#scrim');
  await expect(menu.getByText('Riproduci', { exact: false }).first()).toBeVisible();
  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
});

test('controprova: velo sfumato dentro il collegamento, copertina ferma — le voci dell\'immagine restano', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <a id="lnk" href="https://example.com/scheda-scrim-img" style="position:relative;display:block;width:320px;height:180px">
      <img id="cover" src="${PX}" style="width:100%;height:100%;background:#e07b39">
      <span id="scrim" style="position:absolute;inset:0;${SCRIM};color:#fff;display:flex;align-items:flex-end">Il titolo</span>
    </a>
  </body></html>`);
  const menu = await openMenuOn(page, '#scrim');
  await expect(menu.getByText('Salva immagine come', { exact: false }).first()).toBeVisible();
  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
});

test('controprova: la sfumatura INTERAMENTE coprente invece nasconde (tutti i colori pieni)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <div style="position:relative;width:320px;height:180px">
      <a id="buried" href="https://attacker.example/dietro-il-gradiente" style="position:absolute;inset:0;display:block">Scheda sepolta</a>
      <div id="panel" style="position:absolute;inset:0;background:linear-gradient(rgb(40,40,60),rgb(70,70,90));color:#fff;z-index:2">Pannello sfumato ma opaco</div>
    </div>
  </body></html>`);
  const menu = await openMenuOn(page, '#panel');
  await expectNoLinkEntries(menu);
});

test('porta 5 (#499): collegamento trasparente sotto un paragrafo, stesso ingombro — non esiste per il menu', async ({ openTab, testServer }) => {
  // Il repro esatto del #499: il link è SOTTO il testo (mai raggiungibile da
  // un click sinistro) e ritagliato sullo stesso rettangolo del paragrafo,
  // quindi la sola geometria lo scambiava per "la stessa cosa".
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <div style="position:relative;width:480px">
      <a id="sepolto" href="https://attacker.example/scelto-dalla-pagina" style="position:absolute;inset:0;display:block;z-index:0"></a>
      <p id="testo" style="position:relative;z-index:1;margin:0">Un paragrafo qualunque, con sotto un collegamento ritagliato sul suo stesso ingombro che nessun click sinistro potrà mai raggiungere.</p>
    </div>
  </body></html>`);
  const menu = await openMenuOn(page, '#testo');
  await expectNoLinkEntries(menu);
});
