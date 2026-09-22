// VERIFICA #496 — giro 25. Un giro di ricognizione sulla scheda: nei due temi,
// a finestra stretta, con l'elenco aperto e con la finestra scritta a mano.
// Non asserisce numeri: guarda che niente si sia storto.
import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

function scenario() {
  const feedbacks = [];
  const mittenti = ['tester@example.com', 'claude-worker', 'claude-prober', 'owner@example.com'];
  for (let i = 0; i < 40; i++) {
    feedbacks.push(fb({
      _id: 'x' + i, seq: 100 + i, createdAt: g(1 + (i % 25)),
      name: 'segnalazione numero ' + i, clientId: mittenti[i % mittenti.length],
      status: ['todo', 'working', 'done', 'archived', 'design'][i % 5],
    }));
  }
  const workerLog = [];
  for (let i = 0; i < 20; i++) {
    workerLog.push({ role: 'fixer', startedAt: g(2 + (i % 10)), num: String(100 + i) });
    for (let k = 0; k <= i % 4; k++) workerLog.push({ role: 'verifier', startedAt: g(2 + (i % 10)), num: String(100 + i) });
  }
  for (let i = 0; i < 6; i++) workerLog.push({ role: 'prober', startedAt: g(3) });
  return { feedbacks, workerLog };
}

test('#496 giro25 — la scheda si legge nei due temi, larga e stretta', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const { feedbacks, workerLog } = scenario();
  await apriStatistiche(page, { feedbacks, workerLog }, feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();
  await page.locator('[data-fs-tile="ricevuti"]').click();
  await page.locator('#mgFsLegend li').first().click();
  await expect(page.locator('#mgFsDrill')).toBeVisible();

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
    await page.locator('#mgFsRoot').screenshot({ path: `tests/.shots/496-giro25-${tema}.png` });
  }
  await page.setViewportSize({ width: 760, height: 900 });
  await page.locator('#mgFsRoot').screenshot({ path: 'tests/.shots/496-giro25-stretto.png' });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
    'sbordo orizzontale a 760',
  ).toBe(false);
});

test('#496 giro25 — «Scegli tu» a campi vuoti: cosa dice e cosa conta', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const { feedbacks, workerLog } = scenario();
  await apriStatistiche(page, { feedbacks, workerLog }, feedbacks);
  await page.locator('[data-fs-range="7g"]').click();
  const sette = await page.locator('[data-fs-id="ricevuti"] .mg-tile-n').innerText();
  await page.locator('[data-fs-range="tutto"]').click();
  const tutto = await page.locator('[data-fs-id="ricevuti"] .mg-tile-n').innerText();
  await page.locator('[data-fs-range="custom"]').click();
  const custom = await page.locator('[data-fs-id="ricevuti"] .mg-tile-n').innerText();
  const frase = await page.locator('#mgFsFinestra').innerText();
  console.log('RICEVUTI 7g=%s tutto=%s custom-vuoto=%s | frase=%s', sette, tutto, custom, frase);
  await page.locator('#mgFsRoot').screenshot({ path: 'tests/.shots/496-giro25-customvuoto.png' });
  expect(custom).toBeTruthy();
});

test('#496 giro25 — il tasto destro sulle superfici della scheda', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const { feedbacks, workerLog } = scenario();
  await apriStatistiche(page, { feedbacks, workerLog }, feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();
  const voci = async (sel) => {
    await page.locator(sel).first().click({ button: 'right' });
    const v = await page.locator('.mg-ctxmenu .sn-select-option').allInnerTexts().catch(() => []);
    await page.keyboard.press('Escape');
    return v;
  };
  for (const sel of ['[data-fs-id="ricevuti"]', '[data-fs-id="prober"]', '[data-fs-id="lanci"]',
    '#mgFsLegend li', '.mg-fs-trend-col', '.mg-fs-trend-col--zero', '[data-fs-esito]',
    '[data-fs-range="tutto"]', '[data-fs-creator="__routine"]', '#mgFsPie path']) {
    const n = await page.locator(sel).count();
    console.log('MENU %s (n=%d): %j', sel, n, n ? await voci(sel) : []);
  }
  expect(true).toBe(true);
});

test('#496 giro25 — elenco lungo: quanto ci mette e quanto è alto', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const feedbacks = [];
  for (let i = 0; i < 1500; i++) feedbacks.push(fb({ _id: 'l' + i, seq: 1000 + i, createdAt: g(2), name: 'titolo ' + i }));
  await apriStatistiche(page, { feedbacks, workerLog: [] }, feedbacks.slice(0, 50));
  await page.locator('[data-fs-range="tutto"]').click();
  const t0 = Date.now();
  await page.locator('[data-fs-creator="__tutti"]').click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option').first().click();
  await expect(page.locator('#mgFsDrill')).toBeVisible();
  const ms = Date.now() - t0;
  const righe = await page.locator('#mgFsDrillList li').count();
  const alt = await page.locator('#mgFsDrillList').evaluate((n) => n.getBoundingClientRect().height);
  console.log('ELENCO righe=%d altezza=%s ms=%d titolo=%s', righe, alt, ms, await page.locator('#mgFsDrillTitle').innerText());
  expect(righe).toBeGreaterThan(0);
});
