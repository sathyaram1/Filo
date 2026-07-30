// VERIFICA (temporanea) del feedback #375 — "rendi possibile ridimensionare
// questi componenti" sulla dashboard di gestione.
// Spec scritto dal verificatore in modo black-box: parte dal gesto dell'utente
// (trascino il bordo fra due colonne) e asserisce il SUCCESSO (la colonna
// diventa davvero più larga, la misura viene ricordata), più stress test.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const box = async (page, sel) => {
  const b = await page.locator(sel).boundingBox();
  if (!b) throw new Error(`no box for ${sel}`);
  return b;
};

async function dragBy(page, sel, dx) {
  const b = await box(page, sel);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx / 2, cy, { steps: 5 });
  await page.mouse.move(cx + dx, cy, { steps: 5 });
  await page.mouse.up();
}

test('l\'utente allarga la lista trascinando il bordo, e la misura viene ricordata', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);

  const before = await box(page, '#mgListCol');
  const detailBefore = await box(page, '#mgDetailCol');

  await dragBy(page, '#mgDividerLeft', 120);
  await page.waitForTimeout(100);

  const after = await box(page, '#mgListCol');
  const detailAfter = await box(page, '#mgDetailCol');
  console.log('lista', before.width, '->', after.width, '| dettaglio', detailBefore.width, '->', detailAfter.width);
  expect(after.width).toBeGreaterThan(before.width + 90);
  // Il dettaglio centrale assorbe: si stringe di altrettanto.
  expect(detailAfter.width).toBeLessThan(detailBefore.width - 90);

  // Riapro la pagina: la misura scelta deve essere ancora lì.
  const page2 = await openTab(URL);
  await page2.waitForLoadState('domcontentloaded');
  await page2.waitForTimeout(400);
  const reopened = await box(page2, '#mgListCol');
  console.log('dopo riapertura', reopened.width);
  expect(Math.abs(reopened.width - after.width)).toBeLessThan(3);
});

test('anche il pannello laterale destro si ridimensiona, e il doppio clic ripristina', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);

  const before = await box(page, '#mgSideCol');
  await dragBy(page, '#mgDividerRight', -140); // verso sinistra = più largo
  await page.waitForTimeout(100);
  const after = await box(page, '#mgSideCol');
  console.log('laterale', before.width, '->', after.width);
  expect(after.width).toBeGreaterThan(before.width + 100);

  // Doppio clic → torna alla misura iniziale.
  await page.locator('#mgDividerRight').dblclick();
  await page.waitForTimeout(100);
  const reset = await box(page, '#mgSideCol');
  console.log('dopo doppio clic', reset.width);
  expect(Math.abs(reset.width - before.width)).toBeLessThan(3);

  // ...e anche il ripristino viene ricordato.
  const page2 = await openTab(URL);
  await page2.waitForLoadState('domcontentloaded');
  await page2.waitForTimeout(400);
  expect(Math.abs((await box(page2, '#mgSideCol')).width - before.width)).toBeLessThan(3);
});

test('da tastiera: frecce sul bordo a fuoco, Home ripristina', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);

  const start = (await box(page, '#mgListCol')).width;
  await page.locator('#mgDividerLeft').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  const wider = (await box(page, '#mgListCol')).width;
  console.log('tastiera', start, '->', wider);
  expect(wider).toBeGreaterThan(start + 40);

  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(100);
  const narrower = (await box(page, '#mgListCol')).width;
  expect(narrower).toBeLessThan(wider - 20);

  await page.keyboard.press('Home');
  await page.waitForTimeout(100);
  expect(Math.abs((await box(page, '#mgListCol')).width - start)).toBeLessThan(3);
});

test('STRESS: trascinamenti oltre i bordi, ripetuti e rapidi — niente colonne sparite o traboccate', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);

  const grid = await box(page, '#mgReviewGrid');

  // 1) Trascino il bordo sinistro fuori dallo schermo a sinistra.
  await dragBy(page, '#mgDividerLeft', -5000);
  await page.waitForTimeout(100);
  let list = await box(page, '#mgListCol');
  console.log('lista dopo trascinamento estremo a sinistra', list.width);
  expect(list.width).toBeGreaterThan(80);          // non sparisce
  expect(list.x).toBeGreaterThanOrEqual(grid.x - 1); // non esce dal riquadro

  // 2) ...e molto oltre a destra: il dettaglio centrale deve restare leggibile.
  await dragBy(page, '#mgDividerLeft', 5000);
  await page.waitForTimeout(100);
  list = await box(page, '#mgListCol');
  let detail = await box(page, '#mgDetailCol');
  const side = await box(page, '#mgSideCol');
  console.log('estremo a destra: lista', list.width, 'dettaglio', detail.width, 'laterale', side.width);
  expect(detail.width).toBeGreaterThan(250);
  expect(side.width).toBeGreaterThan(80);
  // Nessuna sovrapposizione: le colonne restano in fila dentro il riquadro.
  expect(list.x + list.width).toBeLessThanOrEqual(detail.x + 1);
  expect(detail.x + detail.width).toBeLessThanOrEqual(side.x + 1);
  expect(side.x + side.width).toBeLessThanOrEqual(grid.x + grid.width + 1);

  // 3) Stesso trattamento al bordo destro.
  await dragBy(page, '#mgDividerRight', 5000);
  await page.waitForTimeout(100);
  await dragBy(page, '#mgDividerRight', -5000);
  await page.waitForTimeout(100);
  list = await box(page, '#mgListCol');
  detail = await box(page, '#mgDetailCol');
  const side2 = await box(page, '#mgSideCol');
  console.log('bordo destro agli estremi: lista', list.width, 'dettaglio', detail.width, 'laterale', side2.width);
  expect(detail.width).toBeGreaterThan(250);
  expect(list.width).toBeGreaterThan(80);
  expect(side2.width).toBeGreaterThan(80);

  // 4) Raffica: 6 doppi clic e trascinamenti minuscoli in rapida sequenza.
  for (let i = 0; i < 6; i++) {
    await page.locator('#mgDividerLeft').dblclick();
    await dragBy(page, '#mgDividerLeft', i % 2 ? 30 : -30);
  }
  await page.waitForTimeout(150);
  const final = await box(page, '#mgListCol');
  console.log('dopo la raffica', final.width);
  expect(final.width).toBeGreaterThan(80);
  expect(final.width).toBeLessThan(grid.width);

  // 5) Cambio tab e ritorno: il layout regge (le tab-lista condividono il pannello).
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.locator('.mg-tab[data-tab="queue"]').click();
  await page.waitForTimeout(150);
  const afterTabs = await box(page, '#mgListCol');
  expect(Math.abs(afterTabs.width - final.width)).toBeLessThan(3);
});

test('STRESS: preferenze salvate assurde/corrotte non rompono il layout', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);

  for (const bad of [
    { leftW: 99999, rightW: 99999 },
    { leftW: -500, rightW: 0 },
    { leftW: 'ciao', rightW: null },
    { leftW: NaN, rightW: undefined },
    'non-un-oggetto',
  ]) {
    await page.evaluate(async (v) => {
      await chrome.storage.local.set({ manageUi: v });
    }, bad);
    const p = await openTab(URL);
    await p.waitForLoadState('domcontentloaded');
    await p.waitForTimeout(350);
    const grid = await box(p, '#mgReviewGrid');
    const list = await box(p, '#mgListCol');
    const detail = await box(p, '#mgDetailCol');
    const side = await box(p, '#mgSideCol');
    console.log('pref', JSON.stringify(v), '→ lista', Math.round(list.width), 'dettaglio', Math.round(detail.width), 'laterale', Math.round(side.width), 'grid', Math.round(grid.width));
    expect(list.width).toBeGreaterThan(80);
    expect(side.width).toBeGreaterThan(80);
    expect(detail.width).toBeGreaterThan(100);
    expect(list.x + list.width).toBeLessThanOrEqual(detail.x + 1);
    expect(detail.x + detail.width).toBeLessThanOrEqual(side.x + 1);
    expect(side.x + side.width).toBeLessThanOrEqual(grid.x + grid.width + 2);
  }
});

test('STRESS: finestra piccola — le colonne si adattano e le preferenze non vengono perse', async ({ openTab, app }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);

  // L'utente allarga parecchio le due colonne esterne.
  await dragBy(page, '#mgDividerLeft', 200);
  await dragBy(page, '#mgDividerRight', -200);
  await page.waitForTimeout(150);
  const wideList = (await box(page, '#mgListCol')).width;
  const wideSide = (await box(page, '#mgSideCol')).width;
  console.log('scelte dall\'utente:', wideList, wideSide);

  // Poi rimpicciolisce la finestra.
  const orig = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const [ww, hh] = w.getSize();
    w.setSize(900, 700);
    return [ww, hh];
  });
  await page.waitForTimeout(500);

  const grid = await box(page, '#mgReviewGrid');
  const list = await box(page, '#mgListCol');
  const detail = await box(page, '#mgDetailCol');
  const side = await box(page, '#mgSideCol');
  console.log('finestra piccola: grid', Math.round(grid.width), 'lista', Math.round(list.width), 'dettaglio', Math.round(detail.width), 'laterale', Math.round(side.width));
  expect(detail.width).toBeGreaterThan(150);
  expect(list.x + list.width).toBeLessThanOrEqual(detail.x + 1);
  expect(detail.x + detail.width).toBeLessThanOrEqual(side.x + 1);
  expect(side.x + side.width).toBeLessThanOrEqual(grid.x + grid.width + 2);

  // Torna grande: ritrova le misure che aveva scelto.
  await app.evaluate(async ({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]);
  }, orig);
  await page.waitForTimeout(500);
  const back = (await box(page, '#mgListCol')).width;
  const backSide = (await box(page, '#mgSideCol')).width;
  console.log('finestra di nuovo grande:', back, backSide);
  expect(Math.abs(back - wideList)).toBeLessThan(4);
  expect(Math.abs(backSide - wideSide)).toBeLessThan(4);
});

test('STRESS: contenuto lungo/ostile nel dettaglio non sfonda le colonne e non esegue script', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);

  const FB = {
    _id: 'v375',
    seq: 375, subSeq: 0,
    name: '<script>window.__xss375 = 1</script>' + 'A'.repeat(400),
    text: '<img src=x onerror="window.__xss375=2">' + 'Lorem ipsum 🎉😀 '.repeat(600) + 'x'.repeat(3000),
    clientId: 'javascript:alert(1)',
    createdAt: '2026-07-24T09:40:33.206Z',
    images: [],
    pipeline: {
      action: 'block_attack', l1Category: 'dangerous', l2Class: 'attack', stage: 'L2',
      verdicts: [{ judge: 'A', class: 'attack', reasoning: 'B'.repeat(5000) }],
      filoSummary: 'C'.repeat(4000),
    },
  };
  await page.evaluate((fb) => { window.__mgTest.setData([fb]); window.__mgTest.setTab('inbox'); }, FB);
  await page.waitForTimeout(200);
  await page.locator('.mg-item').first().click();
  await page.waitForTimeout(200);

  expect(await page.evaluate(() => window.__xss375)).toBeUndefined();

  const grid = await box(page, '#mgReviewGrid');
  let list = await box(page, '#mgListCol');
  let detail = await box(page, '#mgDetailCol');
  let side = await box(page, '#mgSideCol');
  console.log('con contenuto enorme: grid', Math.round(grid.width), 'lista', Math.round(list.width), 'dettaglio', Math.round(detail.width), 'laterale', Math.round(side.width));
  expect(detail.x + detail.width).toBeLessThanOrEqual(side.x + 1);
  expect(side.x + side.width).toBeLessThanOrEqual(grid.x + grid.width + 2);
  // La pagina non scrolla orizzontalmente per colpa del testo lungo.
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('overflow orizzontale della pagina:', overflowX);
  expect(overflowX).toBeLessThanOrEqual(2);

  // Il ridimensionamento continua a funzionare con il dettaglio pieno.
  await dragBy(page, '#mgDividerLeft', 100);
  await page.waitForTimeout(100);
  const list2 = await box(page, '#mgListCol');
  expect(list2.width).toBeGreaterThan(list.width + 70);

  await page.screenshot({ path: 'tests/.shots/verify375-detail-wide.png' });
});
