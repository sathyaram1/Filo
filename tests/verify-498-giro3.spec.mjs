// Verifica avversariale #498 — terzo giro: lo zoom VERO di Filo (quello di
// Ctrl+/-, il fattore di zoom della webContents) e la conversazione aperta.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function misura(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
    const t = document.getElementById('mgTabs').getBoundingClientRect();
    return {
      tabsTop: Math.round(t.top),
      gridBottom: Math.round(g.bottom),
      gridH: Math.round(g.height),
      viewportH: doc.clientHeight,
      scrollH: doc.scrollHeight,
      viewportW: doc.clientWidth,
      scrollW: doc.scrollWidth,
    };
  });
}

test('#498 zoom vero di Filo: le aree restano dentro la finestra', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgReviewGrid')).toBeVisible();
  // Vista dell'owner: il banner di sola lettura è di chi owner non è (e che su
  // questa pagina non vede comunque nessun dato).
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });

  for (const lvl of [0, 1, 2, 3, -1, -2]) {
    await app.evaluate(async ({ webContents }, l) => {
      for (const wc of webContents.getAllWebContents()) {
        try {
          if ((wc.getURL() || '').includes('manage.html')) wc.setZoomLevel(l);
        } catch (_) {}
      }
    }, lvl);
    await page.waitForTimeout(400);
    const m = await misura(page);
    console.log(`ZOOMVERO livello ${lvl}`, JSON.stringify(m));
    expect(m.scrollH, `zoom ${lvl}: la pagina scrolla in verticale`).toBeLessThanOrEqual(m.viewportH + 2);
    expect(m.scrollW, `zoom ${lvl}: la pagina scrolla in orizzontale`).toBeLessThanOrEqual(m.viewportW + 2);
    expect(m.viewportH - m.gridBottom, `zoom ${lvl}: vuoto in fondo`).toBeLessThanOrEqual(30);
  }
  await page.screenshot({ path: 'tests/.shots/v498-zoom.png' });
});

test('#498 conversazione lunga al centro: scrolla la colonna, non la pagina', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgReviewGrid')).toBeVisible();

  const info = await page.evaluate(() => {
    const col = document.getElementById('mgDetailCol');
    const bodies = col.querySelectorAll('.mg-col-body');
    const target = bodies[0];
    if (target) {
      const w = document.createElement('div');
      w.innerHTML = Array.from({ length: 200 }, (_, i) =>
        `<p style="margin:8px 0">Messaggio numero ${i} della conversazione, abbastanza lungo da occupare una riga intera o due nella colonna centrale.</p>`).join('');
      target.appendChild(w);
    }
    const doc = document.documentElement;
    return {
      trovato: !!target,
      quanti: bodies.length,
      detScrollH: target ? target.scrollHeight : null,
      detClientH: target ? target.clientHeight : null,
      pageScrollH: doc.scrollHeight,
      viewportH: doc.clientHeight,
      colBottom: Math.round(col.getBoundingClientRect().bottom),
    };
  });
  console.log('DETTAGLIO LUNGO', JSON.stringify(info));
  expect(info.pageScrollH).toBeLessThanOrEqual(info.viewportH + 1);
  if (info.trovato) expect(info.detScrollH).toBeGreaterThan(info.detClientH);
  await page.screenshot({ path: 'tests/.shots/v498-dettaglio-lungo.png' });
});
