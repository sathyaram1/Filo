// #496 — verifica giro 6 (esplorazione del verificatore). Diagnostico:
// misura e scrive nel log, così un rilievo si legge dai numeri veri.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const T = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";
const CRIT = 'Verifica: 1 rilievo.\nIl verificatore corregge tutti i rilievi; poi un altro verificatore ricontrolla.\n- [1] x';
const PASS = 'Verifica superata.';

const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0, name: o.name || o.id, text: 't',
  clientId: o.clientId === undefined ? 'owner:pino' : o.clientId,
  createdAt: o.at, status: o.status || 'todo', notes: o.notes || '',
  images: [], priority: o.priority || 0,
});

async function apri(page, dati, finestra) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => window.__mgTest.setData(d), dati);
  await page.evaluate(() => window.__mgTest.setWorkerLog([]));
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate((f) => window.__mgTest.setStatsWindow(f), finestra || '30d');
  await page.waitForTimeout(150);
}

// ── A. I numeri delle NOTE portano a quello che hanno contato? ──────────────
test('A1 — «senza data d\'arrivo»: il numero si apre su quelle segnalazioni?', async ({ openTab }) => {
  const page = await openTab(PAGINA);
  await apri(page, [
    fb({ id: 'a', seq: 1, at: iso(1) }),
    fb({ id: 'b', seq: 2, at: null, name: 'Segnalazione senza data' }),
    fb({ id: 'c', seq: 3, at: 'non-una-data', name: 'Segnalazione con data rotta' }),
  ], '30d');
  const nota = page.locator('#mgStSparkNote');
  console.log('[A1] nota:', (await nota.textContent()).trim());
  console.log('[A1] ricevuti:', await page.locator('#mgStTileRicevuti [data-num]').textContent());
  const apribile = await nota.evaluate((el) => ({
    open: el.getAttribute('data-open'), role: el.getAttribute('role'),
    tab: el.getAttribute('tabindex'), cursore: getComputedStyle(el).cursor,
  }));
  console.log('[A1] la nota si apre?', JSON.stringify(apribile));
  await nota.click({ force: true });
  await page.waitForTimeout(150);
  console.log('[A1] elenchi aperti dopo il clic:', await page.locator('#panel-fbstats .mg-st-items').count());
  // Il tasto destro offre qualcosa per QUESTA nota?
  await nota.click({ button: 'right', force: true });
  await page.waitForTimeout(200);
  const voci = await page.locator('.sn-ctx-item, .ctx-item, [class*=ctx] button, [class*=menu] button').allTextContents();
  console.log('[A1] menu tasto destro sulla nota:', JSON.stringify(voci));
  await page.screenshot({ path: 'tests/.shots/496-g6-a1.png', fullPage: false });
});

test('A2 — «mittente non leggibile fuori dal filtro»: il numero porta da qualche parte?', async ({ openTab }) => {
  const page = await openTab(PAGINA);
  // clientId cifrato e illeggibile su questo computer + filtro per creatore.
  const cifrato = { __enc: true, v: 1, ct: 'zzz' };
  await apri(page, [
    fb({ id: 'a', seq: 1, at: iso(1) }),
    fb({ id: 'b', seq: 2, at: iso(1), clientId: cifrato, name: 'Mittente cifrato' }),
  ], '30d');
  await page.evaluate(() => window.__mgTest.setStatsCreators(['owner']));
  await page.waitForTimeout(150);
  const nota = page.locator('#mgStCreatorNote');
  console.log('[A2] nota:', (await nota.isVisible()) ? (await nota.textContent()).trim() : '(nascosta)');
  console.log('[A2] righe creatore:', await page.locator('#mgStCreatorRows .mg-st-row').allTextContents());
  console.log('[A2] ricevuti:', await page.locator('#mgStTileRicevuti [data-num]').textContent());
  if (await nota.isVisible()) {
    await nota.click({ force: true });
    await page.waitForTimeout(150);
    console.log('[A2] elenchi aperti dopo il clic sulla nota:', await page.locator('#panel-fbstats .mg-st-items').count());
  }
});

// ── B. Il fuoco della tastiera dopo aver aperto un elenco ──────────────────
test('B1 — dopo Invio su una riga, il fuoco dove va a finire?', async ({ openTab }) => {
  const page = await openTab(PAGINA);
  await apri(page, [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: `R.${T}${PASS}` }),
    fb({ id: 'b', seq: 2, at: iso(2), status: 'todo', priority: 3 }),
    fb({ id: 'c', seq: 3, at: iso(3), status: 'todo', priority: 3 }),
  ], '30d');
  const riga = page.locator('#mgStHealthRows li[data-open]').first();
  await riga.focus();
  const prima = await page.evaluate(() => ({
    tag: document.activeElement.tagName,
    row: document.activeElement.dataset ? document.activeElement.dataset.row : null,
  }));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const dopo = await page.evaluate(() => ({
    tag: document.activeElement.tagName,
    row: document.activeElement.dataset ? document.activeElement.dataset.row : null,
  }));
  console.log('[B1] fuoco prima:', JSON.stringify(prima), '· dopo:', JSON.stringify(dopo));
  console.log('[B1] elenco aperto:', await page.locator('#mgStHealthRows .mg-st-items').count());
  expect(dopo.row).toBe(prima.row);
});

// ── C. La riga della media: numeri che non si aprono e non si copiano ──────
test('C1 — la riga «In media …» offre qualcosa?', async ({ openTab }) => {
  const page = await openTab(PAGINA);
  await apri(page, [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: `R.${T}${PASS}` }),
    fb({ id: 'b', seq: 2, at: iso(2), status: 'done', notes: `R.${T}${CRIT}${T}${PASS}` }),
  ], '30d');
  const avg = page.locator('#mgStLoopAvg');
  console.log('[C1] riga media:', (await avg.textContent()).trim());
  await avg.click({ button: 'right', force: true });
  await page.waitForTimeout(200);
  const voci = await page.locator('[class*=ctx] [role=menuitem], [class*=ctx] button, .sn-ctx-item').allTextContents();
  console.log('[C1] menu sulla riga media:', JSON.stringify(voci));
});

// ── D. La barretta del grafico: il clic sinistro fa qualcosa? ──────────────
test('D1 — barretta di «Quando arrivano»: clic sinistro', async ({ openTab }) => {
  const page = await openTab(PAGINA);
  await apri(page, [
    fb({ id: 'a', seq: 1, at: iso(1) }),
    fb({ id: 'b', seq: 2, at: iso(2) }),
  ], '30d');
  const barre = page.locator('#mgStSpark .mg-st-spark-bar');
  const n = await barre.count();
  const piena = page.locator('#mgStSpark .mg-st-spark-bar:not(.mg-st-spark-bar--zero)').first();
  console.log('[D1] barrette:', n, '· titolo della prima piena:', await piena.getAttribute('title'));
  console.log('[D1] cursore:', await piena.evaluate((el) => getComputedStyle(el).cursor));
  const finestraPrima = (await page.locator('#mgStRange').textContent()).trim();
  await piena.click({ force: true });
  await page.waitForTimeout(200);
  const finestraDopo = (await page.locator('#mgStRange').textContent()).trim();
  console.log('[D1] finestra prima:', finestraPrima, '· dopo il clic:', finestraDopo);
});

// ── E. Percentuale che si arrotonda a zero su un numero che non è zero ─────
test('E1 — «0% dei ricevuti» con dei risolti veri', async ({ openTab }) => {
  const page = await openTab(PAGINA);
  const dati = [];
  for (let i = 0; i < 400; i += 1) dati.push(fb({ id: `x${i}`, seq: i + 10, at: iso(1) }));
  dati.push(fb({ id: 'ok', seq: 5, at: iso(1), status: 'done' }));
  await apri(page, dati, '30d');
  console.log('[E1] lavorati:', await page.locator('#mgStTileLavorati [data-num]').textContent(),
    '· sotto:', (await page.locator('#mgStTileLavorati [data-sub]').textContent()).trim());
});
