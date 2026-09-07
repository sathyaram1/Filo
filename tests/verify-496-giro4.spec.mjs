// Verifica avversariale #496, quarto giro — scheda «Statistiche feedback».
//
// I giri 1–3 hanno chiuso: numeri fermi, colore delle fette, stato vuoto,
// discesa dai numeri alle segnalazioni, eco delle date, tema scuro. Quelle
// porte le riprova `verify-496-giro3*.spec.mjs`, e sono chiuse.
//
// Qui restano tre punti della STESSA causa dei giri passati — «un numero che
// non dice la verità» e «un numero da cui non si scende» — nell'ultimo pezzo
// di scheda dove la regola non è arrivata.

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

// ── 1. «Riaperture chieste»: chi riapre non scrive un numero ──────────────
// Dalla board la riapertura si registra come una VOCE per persona
// (`reopenRequests[uid] = { at }`, board.js), ed è così che la dashboard la
// legge dappertutto (`hasReopenRequest` in manageReview). Il conto delle
// statistiche la legge invece come se fosse un numero: `Number({…})` è NaN,
// e la riga scrive zero per sempre. È lo stesso caso che il pattern
// «Un numero che non si conosce non si scrive zero» vieta, aggravato: qui il
// numero non è ignoto, è sbagliato.
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
  // Tre riaperture su due segnalazioni: il numero non può essere zero.
  await expect(riga.locator('.mg-st-row-num')).not.toHaveText('0');
  // …e come ogni altra riga della scheda, deve portare alle segnalazioni su
  // cui quegli eventi sono successi (il pattern cita proprio questa riga).
  expect(await riga.getAttribute('data-open')).toBeTruthy();
});

// ── 2. La seconda torta dice quante fail, non QUALI ───────────────────────
// La prima torta apre ogni fetta sull'elenco dei lavori contati; la seconda,
// accanto, sulla stessa schermata, non apre niente.
test('dalle fette della torta degli esiti si arriva ai lavori contati', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'p', seq: 1, at: iso(1), status: 'done', notes: `R.${CRIT(1)}${TURNO}${PASS}` }),
    fb({ id: 'q', seq: 2, at: iso(1), status: 'working', notes: `R.${STOP}` }),
  ]);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  const esitoVoci = page.locator('#mgStOutcomeLegend li[data-group]');
  await expect(esitoVoci).not.toHaveCount(0);
  const apribili = await esitoVoci.evaluateAll((els) => els.filter((e) => e.dataset.open).length);
  expect(apribili).toBeGreaterThan(0);
});

// ── 3. Il taglio a 200: la frase che lo dichiara ──────────────────────────
// «aprile» è il mese; l'imperativo di «aprire» è «aprirle».
test('oltre 200 segnalazioni dietro un numero, la frase in coda è scritta in italiano', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  const tanti = Array.from({ length: 230 }, (_, i) => fb({ id: `f${i}`, seq: i + 1, at: iso(1) }));
  await page.evaluate((d) => window.__mgTest.setData(d), tanti);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('#mgStTileRicevuti').click();
  await page.locator('#mgStDrawer .mg-st-row[data-open]').first().click();
  const testo = (await page.locator('#mgStDrawer .mg-st-item--nota').textContent()).replace(/\s+/g, ' ').trim();
  expect(testo).not.toMatch(/\baprile\b/);
});
