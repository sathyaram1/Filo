// Verifica avversariale #496, quinto giro — scheda «Statistiche feedback».
//
// I quattro giri passati hanno chiuso: numeri fermi, zero al posto di «non lo
// so», colore delle fette, stato vuoto, discesa dai numeri alle segnalazioni,
// eco delle date, tema scuro, tasto destro, riaperture, «aprirle».
//
// Qui si guarda un'altra causa: la scheda si è costruita un vocabolario e una
// tassonomia PROPRI, accanto a quelli che la stessa pagina già usa.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const PASS = 'Verifica superata. Provato tutto.';
const TURNO = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";

const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0, name: o.name || o.id, text: o.text || `Segnalazione ${o.id}`,
  clientId: o.clientId || 'utente-esterno-1', createdAt: o.at,
  status: o.status || 'todo', notes: o.notes || '', images: [], priority: o.priority || 0,
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

// ── 1. «In coda» e «Risolti»: stesso nome, due regole ──────────────────────
// La barra in cima alla pagina ha le sezioni «In coda» e «Risolti» col loro
// numero accanto. La scheda delle statistiche riusa le stesse parole per due
// gruppi che si riempiono con un'altra regola. Sulla stessa schermata, con la
// stessa coda, i due numeri non coincidono.
test('«In coda» e «Risolti» dicono numeri diversi nella barra e nella scheda', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  // 3 todo + 2 working + 1 done non spedito → la SEZIONE «In coda» ne conta 6.
  // La scheda, sotto lo stesso nome, ne conta 3.
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 't1', seq: 1, at: iso(1), status: 'todo' }),
    fb({ id: 't2', seq: 2, at: iso(1), status: 'todo' }),
    fb({ id: 't3', seq: 3, at: iso(1), status: 'todo' }),
    fb({ id: 'w1', seq: 4, at: iso(1), status: 'working' }),
    fb({ id: 'w2', seq: 5, at: iso(1), status: 'revision_capability' }),
    fb({ id: 'd1', seq: 6, at: iso(1), status: 'done' }),
  ]);
  // Nessuna versione rilasciata → `done` è considerato spedito (isShipped) e
  // finisce in «Risolti». Lo dichiariamo esplicitamente per non dipendere dal
  // default.
  await page.evaluate(() => window.__mgTest.setReleasedVersion(''));

  const badgeCoda = await page.locator('.mg-tab[data-tab="queue"] .mg-tab-count').textContent();
  const badgeRis = await page.locator('.mg-tab[data-tab="resolved"] .mg-tab-count').textContent();

  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('#mgStTileRicevuti').click();
  const rows = {};
  for (const li of await page.locator('#mgStDrawer .mg-st-row').all()) {
    const l = (await li.locator('.mg-st-row-label').textContent()).trim();
    const n = (await li.locator('.mg-st-row-num').textContent()).trim();
    rows[l] = n;
  }
  console.log('BARRA  In coda:', badgeCoda, '· Risolti:', badgeRis);
  console.log('SCHEDA righe:', JSON.stringify(rows));
  expect(rows['In coda']).toBeDefined();
});

// ── 2. Il vocabolario degli stati: «Design» / «Allineato» ──────────────────
// feedbackStatus.js è il vocabolario unico degli stati (label per l'utente).
// La scheda ne inventa due nuovi per gli stessi due stati.
test('le etichette degli stati coincidono col vocabolario della pagina', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'g1', seq: 1, at: iso(1), status: 'design' }),
    fb({ id: 'g2', seq: 2, at: iso(1), status: 'aligned' }),
  ]);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('#mgStTileRicevuti').click();
  const etichette = await page.locator('#mgStDrawer .mg-st-row-label').allTextContents();
  const vocab = await page.evaluate(() => {
    const FS = window.SN_FEEDBACK_STATUS;
    return { design: FS.label('design'), aligned: FS.label('aligned') };
  }).catch(() => null);
  console.log('SCHEDA:', JSON.stringify(etichette));
  console.log('VOCABOLARIO:', JSON.stringify(vocab));
  expect(etichette.length).toBeGreaterThan(0);
});

// ── 3. Singolare/plurale nei sottotitoli delle tessere ─────────────────────
test('i sottotitoli delle tessere si accordano al singolare', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'u1', seq: 1, at: iso(1), status: 'todo' }),
  ]);
  await apriStats(page);
  // Il registro si passa come ARGOMENTO: dentro la pagina `iso` non esiste, e
  // scritto senza argomento questo controllo si fermava qui con «iso is not
  // defined» senza guardare un solo sottotitolo.
  await page.evaluate((l) => window.__mgTest.setWorkerLog(l), [
    { role: 'prober', startedAt: iso(0), num: '#1' },
  ]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  const subRic = (await page.locator('#mgStTileRicevuti [data-sub]').textContent()).trim();
  const subProb = (await page.locator('#mgStTileProber [data-sub]').textContent()).trim();
  const subLav = (await page.locator('#mgStTileLavorati [data-sub]').textContent()).trim();
  console.log('SUB ricevuti:', subRic, '| lavorati:', subLav, '| prober:', subProb);
  // Una segnalazione, una categoria, una esecuzione: i sottotitoli si accordano
  // al singolare invece di scrivere «1 categorie» e «1 esecuzioni».
  expect(subRic).not.toMatch(/\b1 categorie\b/);
  expect(subProb).not.toMatch(/\b1 esecuzioni\b/);
});

// ── 4. «Apri la scheda Log per vederle»: la scheda Log non è filtrata ──────
// La riga di un ruolo nel dettaglio dei prober promette di far vedere QUELLE
// esecuzioni. Il clic porta alla scheda Log, che mostra tutto il registro.
test('dalle esecuzioni di una finestra il Log mostra tutto, non quelle', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'z1', seq: 1, at: iso(0), status: 'todo' }),
  ]);
  await apriStats(page);
  await page.evaluate((d) => window.__mgTest.setWorkerLog(d), [
    { role: 'prober', startedAt: iso(0), num: '#1' },
    { role: 'prober', startedAt: iso(40), num: '#2' },
    { role: 'prober', startedAt: iso(41), num: '#3' },
    { role: 'fixer', startedAt: iso(42), num: '#4' },
  ]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('today'));
  await page.locator('#mgStTileProber').click();
  const righe = await page.locator('#mgStDrawer .mg-st-row').allTextContents();
  console.log('DRAWER prober (finestra Oggi):', JSON.stringify(righe));
  const riga = page.locator('#mgStDrawer .mg-st-row').first();
  console.log('TITLE:', await riga.getAttribute('title'));
  await riga.click();
  await expect(page.locator('#panel-log')).toHaveClass(/mg-panel--active/);
  const nLog = await page.locator('#mgLogList .mg-log-row').count();
  console.log('righe nel Log dopo il clic:', nLog);
});

// ── 5. Il filtro creatore e le esecuzioni: leggibilità del risultato ───────
test('filtro «Persone»: cosa dicono le tre tessere', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'p1', seq: 1, at: iso(1), status: 'todo', clientId: 'utente-x' }),
  ]);
  await apriStats(page);
  await page.evaluate((d) => window.__mgTest.setWorkerLog(d), [
    { role: 'prober', startedAt: iso(0), num: '#1' },
    { role: 'fixer', startedAt: iso(0), num: '#2' },
  ]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.evaluate(() => window.__mgTest.setStatsCreators(['owner', 'user']));
  const n = async (id) => (await page.locator(`#${id} [data-num]`).textContent()).trim();
  const s = async (id) => (await page.locator(`#${id} [data-sub]`).textContent()).trim();
  console.log('prober:', await n('mgStTileProber'), '|', await s('mgStTileProber'));
  console.log('riga:', (await page.locator('#mgStRange').textContent()).trim());
  await page.locator('#mgStTileProber').click();
  console.log('drawer:', JSON.stringify(await page.locator('#mgStDrawer .mg-st-row').allTextContents()));
});

// ── 6. Foto: com'è fatta la scheda piena, chiaro e scuro ───────────────────
test('foto della scheda piena', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  const dati = [];
  for (let i = 0; i < 24; i += 1) {
    const g = i % 20;
    const stati = ['todo', 'working', 'done', 'archived', 'attack', 'spam', 'design', 'aligned', 'unlabeled'];
    dati.push(fb({
      id: `f${i}`, seq: i + 1, at: iso(g), status: stati[i % stati.length],
      priority: i % 4,
      clientId: ['utente-1', 'agent:prober', 'routine:verifier', 'owner:me', 'local:x'][i % 5],
      notes: i % 3 === 0 ? `Report.${TURNO}Verifica: ${1 + (i % 3)} rilievi. Il verificatore corregge.${TURNO}${PASS}`
        : i % 3 === 1 ? `Report.${TURNO}Verifica: 2 rilievi. Il lavoro si ferma: serve l'owner.`
          : `Report.${TURNO}${PASS}`,
      reopenRequests: i % 7 === 0 ? { 'u1': { at: iso(0) } } : undefined,
      stalls: i % 9 === 0 ? 1 : 0,
    }));
  }
  await page.evaluate((d) => window.__mgTest.setData(d), dati);
  await apriStats(page);
  await page.evaluate((d) => window.__mgTest.setWorkerLog(d), [
    { role: 'prober', startedAt: iso(0), num: '#1' },
    { role: 'verifier', startedAt: iso(1), num: '#2' },
    { role: 'fixer', startedAt: iso(2), num: '#3' },
  ]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/496-g5-chiaro.png', fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/496-g5-scuro.png', fullPage: true });
  console.log('media:', (await page.locator('#mgStLoopAvg').textContent()).trim());
  console.log('range:', (await page.locator('#mgStRange').textContent()).trim());
});
