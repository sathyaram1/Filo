// Colonne ridimensionabili della dashboard di gestione (feedback #375):
// i due divisori fra lista / dettaglio / pannello laterale si trascinano,
// la misura scelta viene ricordata alla riapertura, il doppio clic la
// ripristina e la finestra stretta non fa collassare il dettaglio centrale.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function colWidth(page, sel) {
  return page.locator(sel).evaluate((el) => el.getBoundingClientRect().width);
}

async function dragDivider(page, sel, dx) {
  const box = await page.locator(sel).boundingBox();
  const y = box.y + Math.min(200, box.height / 2);
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 8 });
  await page.mouse.up();
}

test('trascinando il divisore sinistro la lista si allarga e la misura è ricordata', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgDividerLeft')).toBeVisible();

  const before = await colWidth(page, '#mgListCol');
  await dragDivider(page, '#mgDividerLeft', 140);
  const after = await colWidth(page, '#mgListCol');
  expect(Math.round(after - before)).toBeGreaterThan(110);
  // Traccia visiva ispezionabile della nuova disposizione (cartella gitignorata).
  await page.screenshot({ path: 'tests/.shots/manage-cols-resized.png' });

  // Riapertura della pagina: la larghezza scelta non torna al default.
  await page.goto(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgDividerLeft')).toBeVisible();
  await expect.poll(() => colWidth(page, '#mgListCol')).toBeGreaterThan(before + 110);
});

test('il divisore destro ridimensiona il pannello laterale', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const before = await colWidth(page, '#mgSideCol');
  // Trascinare verso SINISTRA allarga la colonna destra.
  await dragDivider(page, '#mgDividerRight', -120);
  const after = await colWidth(page, '#mgSideCol');
  expect(Math.round(after - before)).toBeGreaterThan(90);

  // Il dettaglio centrale resta il pannello flessibile: si è stretto, non è
  // uscito dal riquadro.
  const geom = await page.evaluate(() => ({
    grid: document.getElementById('mgReviewGrid').getBoundingClientRect().width,
    list: document.getElementById('mgListCol').getBoundingClientRect().width,
    detail: document.getElementById('mgDetailCol').getBoundingClientRect().width,
    side: document.getElementById('mgSideCol').getBoundingClientRect().width,
  }));
  expect(geom.detail).toBeGreaterThan(100);
  expect(geom.list + geom.detail + geom.side).toBeLessThanOrEqual(geom.grid + 4);
});

test('doppio clic sul divisore riporta la colonna alla misura iniziale', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const initial = await colWidth(page, '#mgListCol');
  await dragDivider(page, '#mgDividerLeft', 140);
  expect(await colWidth(page, '#mgListCol')).toBeGreaterThan(initial + 110);

  await page.locator('#mgDividerLeft').dblclick();
  await expect.poll(() => colWidth(page, '#mgListCol')).toBeLessThan(initial + 4);

  // Il ripristino è persistito quanto l'allargamento: riaprendo resta al default.
  await page.goto(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgDividerLeft')).toBeVisible();
  await expect.poll(() => colWidth(page, '#mgListCol')).toBeLessThan(initial + 4);
});

test('con le frecce da tastiera il divisore ridimensiona senza mouse', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const before = await colWidth(page, '#mgListCol');
  await page.locator('#mgDividerLeft').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(() => colWidth(page, '#mgListCol')).toBeGreaterThan(before + 50);
});

test('larghezze salvate più grandi della finestra non fanno sparire il dettaglio', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // Stato "colonne allargate su uno schermo grande, poi finestra piccola".
  await page.evaluate(async () => {
    const key = window.SN_CONST.STORAGE_KEYS.MANAGE_UI;
    await chrome.storage.local.set({ [key]: { leftW: 5000, rightW: 5000 } });
  });

  await page.goto(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgDividerLeft')).toBeVisible();

  const geom = await page.evaluate(() => ({
    grid: document.getElementById('mgReviewGrid').getBoundingClientRect().width,
    list: document.getElementById('mgListCol').getBoundingClientRect().width,
    detail: document.getElementById('mgDetailCol').getBoundingClientRect().width,
    side: document.getElementById('mgSideCol').getBoundingClientRect().width,
  }));
  // La conversazione al centro resta leggibile invece di collassare a zero…
  expect(geom.detail).toBeGreaterThan(280);
  // …e nessuna colonna trabocca fuori dal riquadro sovrapponendosi alle altre.
  expect(geom.list + geom.detail + geom.side).toBeLessThanOrEqual(geom.grid + 4);
  expect(geom.list).toBeLessThan(geom.grid);
});

// #498: «espandi le aree, fai partire le sezioni un poco più in alto». La barra
// delle schede partiva a 40px dal bordo e le tre aree finivano con un'altezza
// scritta a mano (`calc(100vh - 180px)`): senza il banner di sola lettura
// restavano quasi cento pixel vuoti in fondo, col banner la pagina scrollava
// di altrettanto. La misura ora la fa il layout, quindi vale in tutti e due i
// casi — ed è questo che il test guarda.
test('le sezioni partono in alto e le aree arrivano in fondo alla finestra', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgReviewGrid')).toBeVisible();

  // Il banner c'è solo per chi non è l'owner: la dashboard deve riempire la
  // finestra in entrambi i casi (con il banner, e come lo vede l'owner).
  for (const conBanner of [true, false]) {
    await page.evaluate((v) => { document.getElementById('mgBanner').hidden = !v; }, conBanner);

    const geom = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        tabsTop: document.getElementById('mgTabs').getBoundingClientRect().top,
        gridBottom: document.getElementById('mgReviewGrid').getBoundingClientRect().bottom,
        viewport: doc.clientHeight,
        scrollH: doc.scrollHeight,
      };
    });

    // Le aree arrivano fino in fondo (un filo di margine, non un vuoto).
    expect(geom.viewport - geom.gridBottom).toBeLessThanOrEqual(28);
    expect(geom.gridBottom).toBeLessThanOrEqual(geom.viewport + 1);
    // E la pagina non scrolla per colpa di un'altezza scritta a mano.
    expect(geom.scrollH).toBeLessThanOrEqual(geom.viewport + 1);

    // Senza banner (la vista dell'owner) le schede sono la prima cosa e stanno
    // vicine al bordo.
    if (!conBanner) expect(geom.tabsTop).toBeLessThanOrEqual(20);
  }
});

// #498, secondo giro. Le aree si prendono "quello che avanza": quindi tutto ciò
// che sta SOPRA di loro nella stessa colonna glielo toglie. Il riquadro delle
// fusioni che aspettano il via libera dell'owner cresce quanto sono le
// richieste, e le richieste valgono una settimana: con due le aree scendevano
// al minimo e la pagina ricominciava a scorrere, con tre uscivano quasi tutte
// dallo schermo. Ora il riquadro ha un tetto e oltre quello scorre dentro di sé.
function richiestaFinta(i) {
  return {
    id: `req-${i}`,
    branch: `claude/lavoro-numero-${i}`,
    sha: `abcdef012345678901234567890abcdef012345${i}`,
    who: `routine-${i}`,
    origin: 'routine',
    feedbackNum: `#${400 + i}`,
    createdAtMs: Date.now() - 3600_000,
    expiresAtMs: Date.now() + 6 * 86400_000,
    blocks: [
      { kind: 'protected-paths', items: ['src/main/main.js', 'package.json'] },
      { kind: 'workflow', items: ['.github/workflows/release.yml'] },
    ],
  };
}

test('le fusioni in attesa non spingono le aree fuori dallo schermo', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));

  const senza = await page.evaluate(() =>
    Math.round(document.getElementById('mgReviewGrid').getBoundingClientRect().height));

  for (const quante of [1, 2, 3, 6]) {
    await page.evaluate((reqs) => {
      window.SN_MERGE_APPROVALS.render(
        document.getElementById('mgMergeApprovals'), { requests: reqs, failed: [] });
    }, Array.from({ length: quante }, (_, i) => richiestaFinta(i)));
    await page.waitForTimeout(250);

    const g = await page.evaluate(() => {
      const doc = document.documentElement;
      const blocco = document.getElementById('mgMergeApprovals');
      const grid = document.getElementById('mgReviewGrid');
      return {
        bloccoH: Math.round(blocco.getBoundingClientRect().height),
        bloccoScrollH: blocco.scrollHeight,
        gridH: Math.round(grid.getBoundingClientRect().height),
        gridBottom: Math.round(grid.getBoundingClientRect().bottom),
        viewport: doc.clientHeight,
        scrollH: doc.scrollHeight,
      };
    });

    // La pagina non torna a scorrere, e le aree restano in finestra.
    expect(g.scrollH, `${quante} fusioni: la pagina scrolla`).toBeLessThanOrEqual(g.viewport + 1);
    expect(g.gridBottom, `${quante} fusioni: le aree escono dalla finestra`).toBeLessThanOrEqual(g.viewport + 1);
    // Alle aree resta più della metà di quello che avevano senza fusioni: non
    // sono più schiacciate al minimo da un riquadro senza tetto.
    expect(g.gridH, `${quante} fusioni: aree schiacciate`).toBeGreaterThan(senza / 2);
    // E niente sparisce: quello che non entra si raggiunge scorrendo dentro il
    // riquadro, non è tagliato via.
    if (g.bloccoScrollH > g.bloccoH + 1) {
      const scrollabile = await page.evaluate(() => {
        const b = document.getElementById('mgMergeApprovals');
        b.scrollTop = b.scrollHeight;
        return b.scrollTop > 0;
      });
      expect(scrollabile, `${quante} fusioni: il riquadro non scorre`).toBe(true);
    }
  }
});

// #498, secondo giro. La barra di ricerca si tira su di un margine negativo per
// stare attaccata alla barra delle sezioni: quando la barra delle sezioni è
// salita, quel numero è rimasto quello di prima e il campo è finito a due pixel
// dalla riga, due righe orizzontali quasi sovrapposte. Ora la misura è una sola
// e lo stacco non dipende più da chi la ricopia.
test('la barra di ricerca resta staccata dalla barra delle sezioni', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();

  const s = await page.evaluate(() => {
    const t = document.getElementById('mgTabs').getBoundingClientRect();
    const b = document.getElementById('mgSearchBar').getBoundingClientRect();
    const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
    return { sopra: Math.round(b.top - t.bottom), sotto: Math.round(g.top - b.bottom) };
  });
  // Vicina alla barra delle sezioni, perché le appartiene, ma staccata: non
  // incollata alla riga.
  expect(s.sopra).toBeGreaterThanOrEqual(6);
  expect(s.sopra).toBeLessThan(s.sotto);
});
