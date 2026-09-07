// #496 giro 5 — seconda tornata di sonde: stato vuoto della sezione «Quando
// arrivano» e di «Salute della coda», finestra personalizzata con la sola data
// di fine, e la divergenza «Risolti» barra vs scheda col gate della versione.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const PASS = 'Verifica superata.';
const TURNO = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";

const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0, name: o.name || o.id, text: `Segnalazione ${o.id}`,
  clientId: o.clientId || 'utente-esterno-1', createdAt: o.at,
  status: o.status || 'todo', notes: o.notes || '', images: [], priority: o.priority || 0,
  reopenRequests: o.reopenRequests, stalls: o.stalls,
  resolvedInVersion: o.ver,
  _updateTime: 't1',
});

async function pronta(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
}
async function apriStats(page) {
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
}

// ── A. Finestra vuota: cosa resta a schermo ────────────────────────────────
test('finestra vuota: «Quando arrivano» e «Salute della coda»', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'v1', seq: 1, at: iso(40), status: 'todo' }),
  ]);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setWorkerLog([]));
  await page.evaluate(() => window.__mgTest.setStatsWindow('today'));
  await page.waitForTimeout(200);
  console.log('RICEVUTI:', (await page.locator('#mgStTileRicevuti [data-num]').textContent()).trim());
  console.log('SPARK DESC:', (await page.locator('#mgStSparkDesc').textContent()).trim());
  console.log('SPARK barre:', await page.locator('#mgStSpark .mg-st-spark-bar').count());
  console.log('SPARK asse:', (await page.locator('#mgStSparkAxis').textContent()).trim());
  console.log('SALUTE:', JSON.stringify(await page.locator('#mgStHealthRows .mg-st-row').allTextContents()));
  console.log('SEGNALI:', JSON.stringify(await page.locator('#mgStSignalRows .mg-st-row').allTextContents()));
  console.log('CREATORI vuoto visibile:', await page.locator('#mgStCreatorEmpty').isVisible());
  await page.screenshot({ path: 'tests/.shots/496-g5-vuoto.png', fullPage: true });
});

// ── B. Personalizzata con la SOLA data di fine, nel passato e senza dati ────
// La riga sotto i filtri dichiara «fino al …»; l'asse del grafico dice altro.
test('personalizzata con la sola data «al», nel passato', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'x1', seq: 1, at: iso(2), status: 'todo' }),
  ]);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setWorkerLog([]));
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '', '2020-01-15'));
  await page.waitForTimeout(200);
  console.log('RIGA :', (await page.locator('#mgStRange').textContent()).trim());
  console.log('ECO  :', (await page.locator('#mgStDateEcho').textContent()).trim());
  console.log('RICEV:', (await page.locator('#mgStTileRicevuti [data-num]').textContent()).trim());
  console.log('ASSE :', (await page.locator('#mgStSparkAxis').textContent()).trim());
  console.log('BARRE:', await page.locator('#mgStSpark .mg-st-spark-bar').count());
  const t = await page.locator('#mgStSpark .mg-st-spark-bar').first().getAttribute('title');
  console.log('BARRA1 title:', t);
});

// ── C. «Risolti»: la barra e la scheda con una versione rilasciata ──────────
test('«Risolti»: barra e scheda con il gate della versione', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'r1', seq: 1, at: iso(1), status: 'done', ver: '9.9.9' }),
    fb({ id: 'r2', seq: 2, at: iso(1), status: 'done', ver: '9.9.9' }),
    fb({ id: 'r3', seq: 3, at: iso(1), status: 'done', ver: '0.0.1' }),
  ]);
  await page.evaluate(() => window.__mgTest.setReleasedVersion('1.0.0'));
  const badge = async (t) => (await page.locator(`.mg-tab[data-tab="${t}"] .mg-tab-count`).textContent() || '').trim();
  console.log('BARRA In coda:', await badge('queue'), '· Risolti:', await badge('resolved'));
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('#mgStTileRicevuti').click();
  console.log('SCHEDA:', JSON.stringify(await page.locator('#mgStDrawer .mg-st-row').allTextContents()));
  await page.locator('#mgStTileLavorati').click();
  console.log('FASI  :', JSON.stringify(await page.locator('#mgStDrawer .mg-st-row').allTextContents()));
});

// ── D. Il badge di stato del dettaglio e l'etichetta della scheda ───────────
test('lo stesso stato, due nomi sulla stessa pagina', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'd1', seq: 1, at: iso(1), status: 'design' }),
    fb({ id: 'd2', seq: 2, at: iso(1), status: 'aligned' }),
  ]);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('#mgStTileRicevuti').click();
  console.log('SCHEDA:', JSON.stringify(await page.locator('#mgStDrawer .mg-st-row-label').allTextContents()));
  // …e adesso apriamo la segnalazione dalla riga della scheda: si finisce nel
  // dettaglio, dove lo stesso stato ha un altro nome.
  await page.locator('#mgStDrawer .mg-st-row[data-row="design"]').click();
  await page.locator('#mgStDrawer .mg-st-item[data-id="d1"]').click();
  await page.waitForTimeout(300);
  const st = page.locator('#mgDetailState');
  console.log('DETTAGLIO badge:', (await st.textContent() || '').trim(), '| title:', await st.getAttribute('title'));
});

// ── E. Notes non testuali e date esotiche ──────────────────────────────────
test('dati malformati: niente NaN, niente undefined', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate(() => window.__mgTest.setData([
    { _id: 'm1', seq: 1, subSeq: 0, name: 'ok', text: 't', clientId: 'u',
      createdAt: { _seconds: Math.floor(Date.now() / 1000) - 3600 }, status: 'done',
      notes: 12345, priority: '2', images: [], _updateTime: 't1' },
    { _id: 'm2', seq: 2, subSeq: 0, name: 'ko', text: 't', clientId: 'agent:prober',
      createdAt: 'non-una-data', status: 'todo', notes: null, priority: 99, images: [], _updateTime: 't1' },
    { _id: 'm3', seq: 3, subSeq: 0, name: 'nd', text: 't', clientId: 'routine:verifier',
      status: 'archived', notes: { a: 1 }, priority: -5, images: [], _updateTime: 't1' },
    { _id: 'm4', seq: 4, subSeq: 0, name: 'fut', text: 't', clientId: 'u',
      createdAt: new Date(Date.now() + 400 * 86400000).toISOString(), status: 'todo',
      notes: '', priority: 3.7, images: [], _updateTime: 't1' },
  ]));
  await apriStats(page);
  await page.evaluate((d) => window.__mgTest.setWorkerLog(d), [{ role: 'sconosciuto', startedAt: iso(0) }, { role: 'prober', startedAt: iso(0) }]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(200);
  const testo = await page.locator('#panel-fbstats').innerText();
  console.log('NaN?', /NaN/.test(testo), '| undefined?', /undefined/.test(testo), '| Invalid?', /Invalid/.test(testo));
  console.log('RICEV:', (await page.locator('#mgStTileRicevuti [data-num]').textContent()).trim());
  console.log('PROBER:', (await page.locator('#mgStTileProber [data-num]').textContent()).trim(),
    '|', (await page.locator('#mgStTileProber [data-sub]').textContent()).trim());
  await page.locator('#mgStTileProber').click();
  console.log('RUOLI:', JSON.stringify(await page.locator('#mgStDrawer .mg-st-row').allTextContents()));
  console.log('SALUTE:', JSON.stringify(await page.locator('#mgStHealthRows .mg-st-row').allTextContents()));
  console.log('ASSE:', (await page.locator('#mgStSparkAxis').textContent()).trim());
  console.log('RIGA:', (await page.locator('#mgStRange').textContent()).trim());
});
