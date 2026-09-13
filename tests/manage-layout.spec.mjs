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
// fusioni in attesa cresceva quanto erano le richieste e le schiacciava. La
// cura definitiva è stata toglierlo di lì: una fusione ferma ora è una
// segnalazione col quadrato rosso, dentro la lista.

test('le fusioni ferme non stanno più sopra le aree: dai Ricevuti sono sparite', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));

  // Il riquadro che rubava altezza alle tre aree non esiste più nel pannello
  // delle liste: una fusione ferma È una segnalazione col quadrato rosso, e si
  // approva dal suo pannello. Quelle senza segnalazione vivono in Automazioni.
  await expect(page.locator('#panel-list #mgMergeApprovals')).toHaveCount(0);
  await expect(page.locator('#panel-automation #mgMergeApprovalsOrphans')).toHaveCount(1);
});

// #498, terzo giro: sulle schede-lista la colonna è alta ESATTAMENTE la
// finestra, e le tre aree restano dentro anche con lo zoom alzato o una
// finestra bassa.
test('con lo zoom alzato o la finestra bassa le aree restano dentro la finestra', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));

  const misura = () => page.evaluate(() => {
    const doc = document.documentElement;
    const grid = document.getElementById('mgReviewGrid').getBoundingClientRect();
    return {
      gridH: Math.round(grid.height),
      gridBottom: Math.round(grid.bottom),
      viewport: doc.clientHeight,
      scrollH: doc.scrollHeight,
    };
  });

  // a) lo zoom di Filo, che è un tasto solo (Ctrl e il più).
  for (const lvl of [0, 1, 2, 3]) {
    await app.evaluate(async ({ webContents }, l) => {
      for (const wc of webContents.getAllWebContents()) {
        try { if ((wc.getURL() || '').includes('manage.html')) wc.setZoomLevel(l); } catch (_) {}
      }
    }, lvl);
    await page.waitForTimeout(400);
    const g = await misura();
    expect(g.scrollH, `zoom ${lvl}: la pagina scrolla`).toBeLessThanOrEqual(g.viewport + 2);
    expect(g.gridBottom, `zoom ${lvl}: le aree escono dal fondo`).toBeLessThanOrEqual(g.viewport + 2);
    expect(g.gridH, `zoom ${lvl}: delle aree resta solo l'intestazione`).toBeGreaterThan(220);
  }
  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      try { if ((wc.getURL() || '').includes('manage.html')) wc.setZoomLevel(0); } catch (_) {}
    }
  });
  await page.waitForTimeout(300);

  // b) finestre più basse del solito, con la ricerca aperta (che ruba altra aria).
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  for (const [w, h] of [[1366, 768], [1100, 700], [1000, 620]]) {
    await app.evaluate(async ({ BrowserWindow }, [w, h]) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.setContentSize(w, h);
    }, [w, h]);
    await page.waitForTimeout(400);
    const g = await misura();
    expect(g.scrollH, `${w}x${h}: la pagina scrolla`).toBeLessThanOrEqual(g.viewport + 2);
    expect(g.gridBottom, `${w}x${h}: le aree escono dal fondo`).toBeLessThanOrEqual(g.viewport + 2);
  }
  await page.screenshot({ path: 'tests/.shots/manage-aree-finestra-bassa.png' });
});

// L'altra metà della stessa regola: l'altezza fissa vale SOLO dove ci sono le
// tre aree. Le schede senza aree (Statistiche, Modelli, Automazioni, Log) hanno
// contenuti più alti della finestra, e lì la pagina deve continuare a scorrere
// fino in fondo, altrimenti l'ultima impostazione diventa irraggiungibile.
test('le schede senza aree scorrono ancora fino in fondo', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.setContentSize(1200, 700);
  });
  await page.waitForTimeout(300);

  let almenoUnaLunga = false;
  for (const tab of ['stats', 'models', 'automation', 'log']) {
    const btn = page.locator(`.mg-tab[data-tab="${tab}"]`);
    if (!(await btn.count()) || !(await btn.isVisible())) continue;
    await btn.click();
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const doc = document.documentElement;
      doc.scrollTop = doc.scrollHeight;
      return {
        lunga: doc.scrollHeight > doc.clientHeight + 1,
        inFondo: doc.scrollTop + doc.clientHeight >= doc.scrollHeight - 2,
        sbordo: doc.scrollWidth > doc.clientWidth + 1,
      };
    });
    if (r.lunga) {
      almenoUnaLunga = true;
      expect(r.inFondo, `scheda ${tab}: la pagina non scorre fino in fondo`).toBe(true);
    }
    expect(r.sbordo, `scheda ${tab}: sbordo laterale`).toBe(false);
    await page.evaluate(() => { document.documentElement.scrollTop = 0; });
  }
  expect(almenoUnaLunga, 'nessuna scheda più alta della finestra: il caso non è stato provato').toBe(true);
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
