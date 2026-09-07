// Verifica avversariale #496, quarto giro — scheda «Statistiche feedback».
//
// I giri 1–3 hanno chiuso: numeri fermi, colore delle fette, stato vuoto,
// discesa dai numeri alle segnalazioni, eco delle date, tema scuro.
// Qui si guarda quello che RESTA della stessa causa («un numero che non dice
// la verità» e «un numero da cui non si scende»), più i campi che la scheda
// legge dai documenti veri.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const PASS = 'Verifica superata. Provato tutto.';
const TURNO = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";
const CRIT = (n) => Array.from({ length: n }, () => `${TURNO}Verifica: 1 rilievi. Il verificatore corregge.`).join('');
const STOP = `${TURNO}Verifica: 2 rilievi. Il lavoro si ferma: serve l'owner.`;

const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0, name: o.name || o.id, text: o.text || `Segnalazione ${o.id}`,
  clientId: o.clientId || 'utente-esterno-1', createdAt: o.at,
  status: o.status || 'todo', notes: o.notes || '', images: [], priority: o.priority || 0,
  reopenRequests: o.reopenRequests, stalls: o.stalls,
  _updateTime: o.v || 't1',
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

// ── 1. «Riaperture chieste»: il campo vero è una MAPPA, non un numero ──────
// Chi riapre dalla board scrive `reopenRequests[uid] = { at }` (board.js), e la
// dashboard altrove la legge come mappa. Qui il conto la legge come numero.
test('«Riaperture chieste» conta le riaperture vere, non zero', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: `R.${TURNO}${PASS}`,
      reopenRequests: { 'uid-1': { at: iso(0) }, 'uid-2': { at: iso(0) } } }),
    fb({ id: 'b', seq: 2, at: iso(2), status: 'done', notes: `R.${TURNO}${PASS}`,
      reopenRequests: { 'uid-3': { at: iso(0) } } }),
    fb({ id: 'c', seq: 3, at: iso(2), status: 'todo', stalls: 1 }),
  ]);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  const riga = page.locator('#mgStSignalRows .mg-st-row[data-row="riaperture"]');
  const stalli = page.locator('#mgStSignalRows .mg-st-row[data-row="stalli"]');
  console.log('RIAPERTURE:', JSON.stringify({
    riaperture: (await riga.textContent()).replace(/\s+/g, ' ').trim(),
    apribileRiaperture: await riga.getAttribute('data-open'),
    stalli: (await stalli.textContent()).replace(/\s+/g, ' ').trim(),
    apribileStalli: await stalli.getAttribute('data-open'),
  }));
  // Tre riaperture su due segnalazioni: il numero non può essere zero.
  await expect(riga.locator('.mg-st-row-num')).not.toHaveText('0');
  // …e come ogni altro numero della scheda, deve portare alle segnalazioni.
  expect(await riga.getAttribute('data-open')).toBeTruthy();
});

// ── 2. La seconda torta: quante fail, ma non QUALI ────────────────────────
// La prima torta apre ogni fetta sull'elenco dei lavori contati. La seconda,
// accanto, no: stesso posto, stessa forma, due comportamenti.
test('dalle fette della torta degli esiti si arriva ai lavori contati', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'p', seq: 1, at: iso(1), status: 'done', notes: `R.${CRIT(1)}${TURNO}${PASS}` }),
    fb({ id: 'q', seq: 2, at: iso(1), status: 'working', notes: `R.${STOP}` }),
  ]);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  const loopVoci = page.locator('#mgStLoopLegend li[data-group]');
  const esitoVoci = page.locator('#mgStOutcomeLegend li[data-group]');
  const dump = async (loc) => (await loc.evaluateAll((els) => els.map((e) => ({
    gruppo: e.dataset.group, apribile: !!e.dataset.open, testo: (e.textContent || '').replace(/\s+/g, ' ').trim(),
  }))));
  console.log('LOOP:', JSON.stringify(await dump(loopVoci)));
  console.log('ESITI:', JSON.stringify(await dump(esitoVoci)));

  await expect(esitoVoci).not.toHaveCount(0);
  const apribili = await esitoVoci.evaluateAll((els) => els.filter((e) => e.dataset.open).length);
  expect(apribili).toBeGreaterThan(0);
});

// ── 3. Il taglio a 200: la frase che lo dice ──────────────────────────────
test('oltre 200 segnalazioni dietro un numero, la frase in coda è scritta in italiano', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  const tanti = Array.from({ length: 230 }, (_, i) => fb({ id: `f${i}`, seq: i + 1, at: iso(1) }));
  await page.evaluate((d) => window.__mgTest.setData(d), tanti);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('#mgStTileRicevuti').click();
  await page.locator('#mgStDrawer .mg-st-row[data-open]').first().click();
  const coda = page.locator('#mgStDrawer .mg-st-item--nota');
  const testo = (await coda.textContent()).replace(/\s+/g, ' ').trim();
  console.log('CODA 200:', JSON.stringify(testo));
  expect(testo).not.toMatch(/\baprile\b/);
});

// ── 4. Un feedback datato nel futuro (orologio storto) ────────────────────
test('un feedback datato nel futuro non viene attribuito a oggi in silenzio', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  const futuro = new Date(ORA.getTime() + 400 * 86400000).toISOString();
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'oggi', seq: 1, at: iso(0) }),
    fb({ id: 'futuro', seq: 2, at: futuro }),
  ]);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  const riga = await page.locator('#mgStRange').textContent();
  const asse = await page.locator('#mgStSparkAxis span').last().textContent();
  const barre = await page.locator('.mg-st-spark-bar').evaluateAll((els) =>
    els.map((e) => ({ quando: e.dataset.quando || e.title, n: e.dataset.count })).filter((b) => Number(b.n) > 0));
  console.log('FUTURO:', JSON.stringify({ riga: riga.trim(), asse: asse.trim(), barre }));
  const ricevuti = await page.locator('#mgStTileRicevuti [data-num]').textContent();
  console.log('FUTURO ricevuti:', ricevuti);
});

// ── 5. Il filtro creatore che azzera le esecuzioni ────────────────────────
test('«solo le persone»: lo zero dei prober dice perché', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [fb({ id: 'a', seq: 1, at: iso(1) })]);
  await page.evaluate((r) => window.__mgTest.setWorkerLog(r),
    [{ role: 'prober', startedAt: iso(1), num: '#1' }, { role: 'verifier', startedAt: iso(1), num: '#1' }]);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.evaluate(() => window.__mgTest.setStatsCreators(['owner', 'user']));
  const num = await page.locator('#mgStTileProber [data-num]').textContent();
  const sub = await page.locator('#mgStTileProber [data-sub]').textContent();
  await page.locator('#mgStTileProber').click();
  const cassetto = (await page.locator('#mgStDrawer').textContent()).replace(/\s+/g, ' ').trim();
  console.log('SOLO PERSONE:', JSON.stringify({ num, sub, cassetto }));
});

// ── 6. Note di verifica scritte da un umano: il conteggio si fida? ────────
test('una frase dell’owner che cita la verifica non diventa un giro di verifica', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'u', seq: 1, at: iso(1), status: 'todo',
      notes: `${TURNO}Ciao, ho letto il report.\nVerifica superata? non mi pare.` }),
  ]);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  const media = (await page.locator('#mgStLoopAvg').textContent()).replace(/\s+/g, ' ').trim();
  const vuoto = await page.locator('#mgStLoopEmpty').isVisible();
  console.log('NOTE UMANE:', JSON.stringify({ media, vuoto }));
});
