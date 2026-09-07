// Verifica avversariale #498 — «espandi le aree, fai partire le sezioni
// (ricevuti, in coda…) un poco più in alto» su filo://manage/manage.html.
//
// Il sintomo utente: le schede partivano troppo in basso e le tre aree non
// arrivavano in fondo alla finestra. Qui si prova a romperlo: banner, barra di
// ricerca aperta, blocco delle fusioni in attesa, schede andate a capo su
// finestra stretta, finestra bassa, ridimensionamento a pagina aperta, zoom,
// tema scuro, e le altre schede della dashboard.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function geom(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const r = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, height: b.height, width: b.width };
    };
    return {
      tabs: r('mgTabs'),
      grid: r('mgReviewGrid'),
      banner: r('mgBanner'),
      searchbar: r('mgSearchBar'),
      list: r('mgListCol'),
      detail: r('mgDetailCol'),
      side: r('mgSideCol'),
      viewportH: doc.clientHeight,
      viewportW: doc.clientWidth,
      scrollH: doc.scrollHeight,
      bodyScrollW: doc.scrollWidth,
    };
  });
}

async function setWindowSize(app, w, h) {
  await app.evaluate(async ({ BrowserWindow }, [w2, h2]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(w2, h2);
  }, [w, h]);
}

test('#498 caso base owner: schede in alto, aree fino in fondo, niente scroll', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgReviewGrid')).toBeVisible();
  const g = await geom(page);
  console.log('BASE', JSON.stringify(g));
  expect(g.tabs.top).toBeLessThanOrEqual(20);
  expect(g.viewportH - g.grid.bottom).toBeLessThanOrEqual(28);
  expect(g.scrollH).toBeLessThanOrEqual(g.viewportH + 1);
});

test('#498 con la barra di ricerca aperta le aree restano a fondo pagina', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgReviewGrid')).toBeVisible();
  const prima = await geom(page);

  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  const dopo = await geom(page);
  console.log('RICERCA', JSON.stringify(dopo));

  // La barra di ricerca non deve né far scrollare la pagina né lasciare un
  // vuoto in fondo: le aree si accorciano di quel tanto.
  expect(dopo.scrollH).toBeLessThanOrEqual(dopo.viewportH + 1);
  expect(dopo.viewportH - dopo.grid.bottom).toBeLessThanOrEqual(28);
  // Distanza fra la barra delle schede e la barra di ricerca: se è negativa o
  // quasi zero, la barra tocca le schede.
  const gap = dopo.searchbar.top - dopo.tabs.bottom;
  console.log('GAP tabs→searchbar', gap, 'prima grid h', prima.grid.height, 'dopo', dopo.grid.height);
  expect(gap).toBeGreaterThanOrEqual(0);
});

test('#498 col banner di sola lettura le aree arrivano lo stesso in fondo', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = false; });
  const g = await geom(page);
  console.log('BANNER', JSON.stringify(g));
  expect(g.scrollH).toBeLessThanOrEqual(g.viewportH + 1);
  expect(g.viewportH - g.grid.bottom).toBeLessThanOrEqual(28);
});

test('#498 col blocco delle fusioni in attesa le aree non escono dalla finestra', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    const el = document.getElementById('mgMergeApprovals');
    el.hidden = false;
    el.innerHTML = '<div style="padding:14px;border:1px solid #999;border-radius:8px">'
      + 'Fusione ferma: ramo claude/prova — in attesa del tuo via libera</div>';
  });
  const g = await geom(page);
  console.log('MERGE', JSON.stringify(g));
  expect(g.scrollH).toBeLessThanOrEqual(g.viewportH + 1);
  expect(g.viewportH - g.grid.bottom).toBeLessThanOrEqual(28);
  expect(g.grid.height).toBeGreaterThan(200);
});

test('#498 finestra stretta: schede a capo, aree ancora a fondo pagina', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgReviewGrid')).toBeVisible();

  for (const [w, h] of [[900, 800], [700, 800], [520, 800]]) {
    await setWindowSize(app, w, h);
    await page.waitForTimeout(400);
    const g = await geom(page);
    console.log(`STRETTA ${w}x${h}`, JSON.stringify(g));
    expect(g.scrollH, `${w}x${h}: la pagina scrolla`).toBeLessThanOrEqual(g.viewportH + 2);
    expect(g.viewportH - g.grid.bottom, `${w}x${h}: vuoto in fondo`).toBeLessThanOrEqual(28);
    // Le colonne non devono sbordare in orizzontale.
    expect(g.bodyScrollW).toBeLessThanOrEqual(g.viewportW + 2);
  }
});

test('#498 finestra bassa: cosa succede sotto i 600 e i 460 pixel di altezza', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgReviewGrid')).toBeVisible();

  for (const h of [700, 600, 500, 420]) {
    await setWindowSize(app, 1100, h);
    await page.waitForTimeout(400);
    const g = await geom(page);
    console.log(`BASSA h=${h}`, JSON.stringify({
      viewportH: g.viewportH, scrollH: g.scrollH,
      gridH: g.grid.height, gridBottom: g.grid.bottom, tabsTop: g.tabs.top,
    }));
  }
});

test('#498 ridimensionando a pagina aperta le aree si riadattano', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgReviewGrid')).toBeVisible();
  const g1 = await geom(page);
  await setWindowSize(app, 1400, 1000);
  await page.waitForTimeout(500);
  const g2 = await geom(page);
  console.log('RESIZE', g1.grid.height, '→', g2.grid.height, 'viewport', g1.viewportH, '→', g2.viewportH);
  expect(g2.grid.height).toBeGreaterThan(g1.grid.height);
  expect(g2.viewportH - g2.grid.bottom).toBeLessThanOrEqual(28);
  expect(g2.scrollH).toBeLessThanOrEqual(g2.viewportH + 1);
});

test('#498 le altre schede della dashboard: quanta finestra riempiono', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  for (const tab of ['queue', 'resolved', 'archived', 'stats', 'models', 'automation', 'log']) {
    await page.locator(`.mg-tab[data-tab="${tab}"]`).click();
    await page.waitForTimeout(350);
    const info = await page.evaluate(() => {
      const doc = document.documentElement;
      const p = document.querySelector('.mg-panel--active');
      const b = p ? p.getBoundingClientRect() : null;
      const grid = document.getElementById('mgReviewGrid');
      const gb = grid && grid.offsetParent ? grid.getBoundingClientRect() : null;
      return {
        panel: p ? p.id : null,
        panelBottom: b ? Math.round(b.bottom) : null,
        gridBottom: gb ? Math.round(gb.bottom) : null,
        viewportH: doc.clientHeight,
        scrollH: doc.scrollHeight,
      };
    });
    console.log('TAB', tab, JSON.stringify(info));
  }
});

test('#498 traccia visiva: chiaro e scuro', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgReviewGrid')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/.shots/v498-chiaro.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/v498-scuro.png' });
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/v498-ricerca.png' });
});
