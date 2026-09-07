// #496 — verifica giro 6 (esplorazione del verificatore). Diagnostico.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const T = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";
const CRIT = 'Verifica: 1 rilievo.\nIl verificatore corregge tutti i rilievi; poi un altro verificatore ricontrolla.\n- [1] x';
const PASS = 'Verifica superata.';
const CTX = '.mg-ctxmenu [role=menuitem], .mg-ctxmenu [role=menuitemradio]';

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

const menuSu = async (page, loc) => {
  await loc.click({ button: 'right', force: true });
  await page.waitForTimeout(250);
  const v = await page.locator(CTX).allTextContents();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  return v.map((s) => s.trim());
};

// ── B. Il fuoco della tastiera dopo aver aperto un elenco ──────────────────
test('B1 — dopo Invio su una riga il fuoco si perde: quanti Tab per tornare?', async ({ openTab }) => {
  const page = await openTab(PAGINA);
  await apri(page, [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: `R.${T}${PASS}` }),
    fb({ id: 'b', seq: 2, at: iso(2), status: 'todo', priority: 3, name: 'Bravo' }),
    fb({ id: 'c', seq: 3, at: iso(3), status: 'todo', priority: 3, name: 'Charlie' }),
  ], '30d');
  const riga = page.locator('#mgStHealthRows li[data-open]').first();
  await riga.scrollIntoViewIfNeeded();
  await riga.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const dopo = await page.evaluate(() => ({
    tag: document.activeElement.tagName,
    cls: document.activeElement.className,
  }));
  console.log('[B1] fuoco dopo Invio:', JSON.stringify(dopo));
  console.log('[B1] elenco aperto:', await page.locator('#mgStHealthRows .mg-st-items').count());
  // Quanti Tab servono per raggiungere la PRIMA voce dell'elenco appena aperto?
  let passi = 0;
  for (; passi < 120; passi += 1) {
    await page.keyboard.press('Tab');
    const dentro = await page.evaluate(() =>
      !!(document.activeElement && document.activeElement.closest
        && document.activeElement.closest('#mgStHealthRows .mg-st-items')));
    if (dentro) break;
  }
  console.log('[B1] Tab necessari per entrare nell\'elenco appena aperto:', passi + 1);
  // Stessa prova sulla voce di legenda di una torta.
  const voce = page.locator('#mgStLoopLegend li[data-open]').first();
  await voce.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  console.log('[B1] legenda: fuoco dopo Invio:',
    await page.evaluate(() => document.activeElement.tagName));
  console.log('[B1] legenda: elenco aperto:', await page.locator('#mgStLoopLegend .mg-st-legend-items').count());
  // E su una tessera (che è un <button> e non viene ricreata)?
  const tile = page.locator('#mgStTileRicevuti');
  await tile.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  console.log('[B1] tessera: fuoco dopo Invio:',
    await page.evaluate(() => document.activeElement.id || document.activeElement.tagName));
});

// ── A. I numeri delle NOTE portano a quello che hanno contato? ─────────────
test('A — le tre note della scheda: cosa offrono?', async ({ openTab }) => {
  const page = await openTab(PAGINA);
  await apri(page, [
    fb({ id: 'a', seq: 1, at: iso(1) }),
    fb({ id: 'b', seq: 2, at: null, name: 'Senza data' }),
    fb({ id: 'c', seq: 3, at: iso(1), status: 'FENC:zzz', name: 'Stato cifrato' }),
    fb({ id: 'd', seq: 4, at: iso(1), clientId: 'FENC:qqq', name: 'Mittente cifrato' }),
  ], '30d');
  for (const id of ['mgStSparkNote', 'mgStLoopUnreadable', 'mgStCreatorNote']) {
    const n = page.locator(`#${id}`);
    const vis = await n.isVisible();
    console.log(`[A] #${id} visibile:`, vis, vis ? '· testo: ' + (await n.textContent()).trim() : '');
    if (vis) console.log(`[A] #${id} menu:`, JSON.stringify(await menuSu(page, n)));
  }
  // Ora col filtro per creatore acceso: chi non dice chi l'ha mandato esce.
  await page.evaluate(() => window.__mgTest.setStatsCreators(['owner']));
  await page.waitForTimeout(200);
  const cn = page.locator('#mgStCreatorNote');
  console.log('[A] col filtro — creatorNote:', (await cn.isVisible()) ? (await cn.textContent()).trim() : '(nascosta)');
  console.log('[A] col filtro — ricevuti:', await page.locator('#mgStTileRicevuti [data-num]').textContent());
  console.log('[A] col filtro — righe creatore:', JSON.stringify(await page.locator('#mgStCreatorRows .mg-st-row').allTextContents()));
  if (await cn.isVisible()) console.log('[A] col filtro — menu sulla nota:', JSON.stringify(await menuSu(page, cn)));
});

// ── C. La riga «In media …» ────────────────────────────────────────────────
test('C — la riga della media e la barretta del grafico', async ({ openTab }) => {
  const page = await openTab(PAGINA);
  await apri(page, [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: `R.${T}${PASS}` }),
    fb({ id: 'b', seq: 2, at: iso(2), status: 'done', notes: `R.${T}${CRIT}${T}${PASS}` }),
  ], '30d');
  const avg = page.locator('#mgStLoopAvg');
  console.log('[C] media:', (await avg.textContent()).trim());
  console.log('[C] menu sulla media:', JSON.stringify(await menuSu(page, avg)));
  const desc = page.locator('#mgStSparkDesc');
  console.log('[C] desc arrivi:', (await desc.textContent()).trim());
  const piena = page.locator('#mgStSpark .mg-st-spark-bar:not(.mg-st-spark-bar--zero)').first();
  console.log('[C] barretta:', await piena.getAttribute('title'),
    '· cursore:', await piena.evaluate((el) => getComputedStyle(el).cursor));
  const prima = (await page.locator('#mgStRange').textContent()).trim();
  await piena.click({ force: true });
  await page.waitForTimeout(250);
  const dopo = (await page.locator('#mgStRange').textContent()).trim();
  console.log('[C] finestra col clic sinistro sulla barretta — prima:', prima, '· dopo:', dopo);
  console.log('[C] menu sulla barretta:', JSON.stringify(await menuSu(page, piena)));
});

// ── D. Le tessere: sottotitolo e menu quando i numeri non ci sono ──────────
test('D — percentuale che si arrotonda a zero, e la tessera «lavorati»', async ({ openTab }) => {
  const page = await openTab(PAGINA);
  const dati = [];
  for (let i = 0; i < 400; i += 1) dati.push(fb({ id: `x${i}`, seq: i + 10, at: iso(1) }));
  dati.push(fb({ id: 'ok', seq: 5, at: iso(1), status: 'done' }));
  await apri(page, dati, '30d');
  console.log('[D] lavorati:', await page.locator('#mgStTileLavorati [data-num]').textContent(),
    '· sotto:', (await page.locator('#mgStTileLavorati [data-sub]').textContent()).trim());
  await page.locator('#mgStTileLavorati').click();
  await page.waitForTimeout(200);
  console.log('[D] drawer:', JSON.stringify(await page.locator('#mgStDrawer .mg-st-row').allTextContents()));
});

// ── E. Un giro di verifica dentro un turno «Filo ha risposto» ──────────────
test('E — chi scrive la nota: turni dell\'agente vs turni di Filo', async ({ openTab }) => {
  const page = await openTab(PAGINA);
  const FILO = '\n--- Filo ha risposto il 1/1/2026 ---\n';
  const UTENTE = '\n--- La tua risposta del 1/1/2026 ---\n';
  await apri(page, [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: `R.${FILO}${PASS}`, name: 'Pass dentro un turno di Filo' }),
    fb({ id: 'b', seq: 2, at: iso(1), status: 'todo', notes: `R.${UTENTE}${PASS}`, name: 'Pass dentro un turno utente' }),
  ], '30d');
  console.log('[E] legenda giri:', JSON.stringify(await page.locator('#mgStLoopLegend li').allTextContents()));
  console.log('[E] media:', (await page.locator('#mgStLoopAvg').textContent()).trim());
});
