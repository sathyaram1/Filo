// Feedback #499: il menu offriva azioni su un collegamento che l'utente non
// vede, senza dire dove porta.
//
// Da quando il tasto destro guarda anche SOTTO al punto cliccato per ritrovare
// il collegamento di una scheda (#444), una pagina può mettere un collegamento
// invisibile e non cliccabile sotto un paragrafo qualunque, ritagliato con lo
// stesso ingombro: il menu lo adotta e offre «Apri in nuova tab», «Copia URL»,
// «Salva link per dopo» e «Condividi link» su un indirizzo scelto dal sito.
// L'utente crede di copiare o condividere la pagina che sta leggendo.
//
// Le difese contro le sovrapposizioni larghe (barra fissa, riquadro dei cookie,
// manto steso su tutta la pagina) funzionano e restano dove sono: questo caso
// non lo prendono, e non possono — un collegamento largo quanto il paragrafo
// che gli sta sopra è geometricamente IDENTICO alla copertina di una scheda
// vera, dove adottarlo è quello che l'utente vuole. Quello che mancava è dirlo:
// dove porta l'indirizzo su cui agiscono quelle voci. Filo non ha una barra di
// stato che lo mostri fermando il mouse, quindi il menu è l'unico posto dove
// può stare scritto.
//
// I test asseriscono il SUCCESSO dal punto di vista di chi guarda: la riga con
// la destinazione c'è, e dice l'host VERO del collegamento su cui le voci
// agiranno. Senza il fix la riga non esiste → rossi.

import { test, expect } from './fixtures/electron.mjs';

const LINK_LABELS = ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link'];

async function openMenuOn(page, selector) {
  await page.locator(selector).click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu;
}

// La pagina della lamentela: un paragrafo di testo normale e, sotto, un
// collegamento trasparente della stessa identica misura.
function paragrafoConLinkSottoHtml(href) {
  return `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <div id="zona" style="position:relative;width:520px;height:120px">
      <a id="nascosto" href="${href}" style="position:absolute;inset:0;display:block;opacity:0"></a>
      <p id="testo" style="position:absolute;inset:0;margin:0;background:#fffdf8">
        Un paragrafo qualunque di un articolo qualunque. Chi legge non vede
        nessun collegamento, e cliccando qui non va da nessuna parte.
      </p>
    </div>
  </body></html>`;
}

test('#499 collegamento invisibile sotto un paragrafo: il menu dice dove porta', async ({ openTab, testServer }) => {
  const href = 'https://sito-che-decide.example/pagina-scelta-da-lui';
  const page = await testServer.openReady(openTab, paragrafoConLinkSottoHtml(href));
  const menu = await openMenuOn(page, '#testo');
  await page.screenshot({ path: 'tests/.shots/context-menu-destinazione-link-nascosto.png' }).catch(() => {});

  // Il menu adotta il collegamento (è il comportamento di #444, e sulle schede
  // vere è quello giusto): allora deve dire su cosa stanno per agire le voci.
  const dest = menu.locator('.sn-menu-dest');
  await expect(dest).toHaveCount(1);
  await expect(dest.locator('.sn-menu-dest-host')).toHaveText('sito-che-decide.example');
  await expect(dest.locator('.sn-menu-dest-rest')).toHaveText('/pagina-scelta-da-lui');
  // L'indirizzo intero resta leggibile fermando il mouse.
  await expect(dest).toHaveAttribute('data-dest', href);
});

test('#499 la destinazione sta SOPRA le voci del collegamento, prima che si clicchi', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, paragrafoConLinkSottoHtml('https://sito-che-decide.example/altrove'));
  const menu = await openMenuOn(page, '#testo');

  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
  // L'ordine conta: si legge dove si va e POI si sceglie l'azione.
  const ordine = await menu.evaluate((root) => {
    const nodi = Array.from(root.children);
    const dest = nodi.findIndex((n) => n.classList.contains('sn-menu-dest'));
    const apri = nodi.findIndex((n) => (n.textContent || '').includes('Apri in nuova tab'));
    return { dest, apri, tag: nodi[dest]?.tagName };
  });
  expect(ordine.dest).toBeGreaterThanOrEqual(0);
  expect(ordine.dest).toBeLessThan(ordine.apri);
  // Non è un'azione: è l'etichetta di quelle sotto, quindi non è un bottone.
  expect(ordine.tag).not.toBe('BUTTON');
});

test('#499 quando il collegamento non si vede, l\'utente vede almeno dove porta (non l\'indirizzo della pagina)', async ({ app, openTab, testServer }) => {
  const href = 'https://sito-che-decide.example/riscossione?importo=200';
  const page = await testServer.openReady(openTab, paragrafoConLinkSottoHtml(href));
  const menu = await openMenuOn(page, '#testo');

  // La riga dice l'host del LINK, non quello della pagina che si sta leggendo.
  const host = await menu.locator('.sn-menu-dest-host').textContent();
  const hostPagina = await page.evaluate(() => location.hostname);
  expect(host).toBe('sito-che-decide.example');
  expect(host).not.toBe(hostPagina);

  // E quello che finisce negli appunti è proprio l'indirizzo annunciato: la
  // riga non può dire una cosa e l'azione farne un'altra.
  await menu.locator('button', { hasText: 'Copia URL' }).first().click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
    .toBe(href);
});

test('#499 anche sul collegamento cliccato di proposito: il testo può mentire, la riga no', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <p><a id="lnk" href="https://accessi.example/login">www.banca.it</a></p>
  </body></html>`);
  const menu = await openMenuOn(page, '#lnk');

  await expect(menu.locator('.sn-menu-dest-host')).toHaveText('accessi.example');
});

test('#499 scheda a strati: dal velo o dal collegamento scoperto, la riga è la stessa', async ({ openTab, testServer }) => {
  // Il velo trasparente copre solo la metà alta della scheda: sopra si clicca
  // lui (e il collegamento arriva da sotto), sotto si clicca il collegamento
  // di persona. Due strade per la stessa scheda: stesso menu, stessa riga.
  const href = 'https://esempio.example/scheda';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <div id="card" style="position:relative;width:320px;height:120px">
      <a id="lnk" href="${href}" style="position:absolute;inset:0;display:block;background:#f0e6d8"></a>
      <span id="velo" style="position:absolute;left:0;right:0;top:0;height:60px;background:rgba(0,0,0,.001)"></span>
    </div>
  </body></html>`);

  const punti = await page.evaluate(() => {
    const r = document.getElementById('card').getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    return { velo: { x, y: Math.round(r.top + 30) }, link: { x, y: Math.round(r.bottom - 30) } };
  });

  for (const [dove, p] of Object.entries(punti)) {
    await page.mouse.click(p.x, p.y, { button: 'right' });
    const menu = page.locator('.sn-menu');
    await expect(menu, `menu aperto dal punto "${dove}"`).toBeVisible();
    await expect(menu.locator('.sn-menu-dest')).toHaveAttribute('data-dest', href);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  }
});

test('#499 nessun collegamento nel menu, nessuna riga della destinazione', async ({ openTab, testServer }) => {
  // Il manto invisibile steso su tutta la pagina resta scartato dal freno (#444):
  // niente voci del link, e quindi neanche una destinazione da annunciare.
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <a id="manto" href="https://sito-che-decide.example/pagina-scelta-da-lui" style="position:absolute;inset:0;z-index:0"></a>
    <p id="testo" style="position:relative;z-index:1">Un paragrafo qualunque, senza nessun link in vista.</p>
  </body></html>`);
  const menu = await openMenuOn(page, '#testo');

  await expect(menu.locator('.sn-menu-dest')).toHaveCount(0);
  for (const label of LINK_LABELS) {
    await expect(menu.getByText(label, { exact: true })).toHaveCount(0);
  }
});
