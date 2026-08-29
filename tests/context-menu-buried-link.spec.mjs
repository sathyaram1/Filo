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
