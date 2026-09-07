// Spec Playwright per la scheda «Statistiche feedback» della dashboard di
// gestione (filo://manage/manage.html, feedback #496).
//
// Assert di COMPORTAMENTO — cosa vede e cosa può fare l'owner:
//   - la scheda esiste, ha il suo pannello e mostra i tre numeri chiesti
//     (feedback ricevuti, feedback lavorati, prober lanciati);
//   - la finestra di riferimento si cambia e i numeri cambiano con lei,
//     comprese le due date scelte a mano;
//   - il filtro per creatore funziona, anche col gruppo «Routine cloud»;
//   - «Feedback ricevuti» si apre sulla ripartizione per categoria (ed è la
//     stessa cosa per gli altri due numeri);
//   - la torta dei giri di verifica ha le fette giuste, coi fermati a parte,
//     e la seconda torta separa le critiche che fermano da quelle no.
//
// I conti PURI stanno in tests/unit/feedbackStats.test.mjs: qui si prova che la
// pagina li mostra e che i controlli li muovono davvero.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

// Le note di verifica hanno la forma che scrive il verificatore vero
// (SN_VERIFIER_ROUND.roundNote): un pass, un giro con rilievi corretti, un giro
// che ferma il lavoro.
const PASS = 'Verifica superata. Provato tutto.';
const CRITICA = 'Verifica: 1 rilievo.\nIl verificatore corregge tutti i rilievi; poi un altro verificatore ricontrolla.\n- [2] Il pulsante non salva.';
const FERMATA = 'Verifica: 1 rilievo.\nIl lavoro si ferma: c\'è un rilievo di livello 2 o 3 che non si può correggere da soli (bilancio esaurito, o chiede una tua decisione).\n- [3] Perde i dati.';
const TURNO = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";

const fb = (o) => ({
  _id: o.id,
  seq: o.seq,
  subSeq: 0,
  name: o.id,
  text: `Segnalazione ${o.id}`,
  clientId: o.clientId || 'utente-esterno-1',
  createdAt: o.at,
  status: o.status || 'todo',
  notes: o.notes || '',
  images: [],
  priority: o.priority || 0,
});

// Due gruppi di date: «adesso» (dentro qualunque finestra) e «un anno fa»
// (fuori da tutte tranne «Sempre»).
const ORA = new Date();
const iso = (giorniFa) => new Date(ORA.getTime() - giorniFa * 86400000).toISOString();

const DATI = [
  // Cinque di questa settimana, da mittenti diversi.
  fb({ id: 'a', seq: 101, at: iso(1), status: 'done', clientId: 'utente-esterno-1', notes: `Report.${TURNO}${PASS}` }),
  fb({ id: 'b', seq: 102, at: iso(1), status: 'done', clientId: 'routine:prober', notes: `Report.${TURNO}${CRITICA}${TURNO}${PASS}` }),
  fb({ id: 'c', seq: 103, at: iso(2), status: 'working', clientId: 'routine:prober', notes: 'Sto lavorando.' }),
  fb({ id: 'd', seq: 104, at: iso(2), status: 'design', clientId: 'routine:new-work', notes: `Report.${TURNO}${CRITICA}${TURNO}${FERMATA}` }),
  fb({ id: 'e', seq: 105, at: iso(3), status: 'todo', clientId: 'owner:pino', priority: 3 }),
  // Una vecchia: c'è solo con «Sempre».
  fb({ id: 'f', seq: 106, at: iso(300), status: 'archived', clientId: 'utente-esterno-2' }),
];

// Registro delle esecuzioni: due esplorazioni recenti, una vecchia, una
// verifica, e un «Fermo» che non è lavoro.
const LOG = [
  { role: 'prober', startedAt: iso(1), num: '' },
  { role: 'prober', startedAt: iso(2), num: '' },
  { role: 'prober', startedAt: iso(300), num: '' },
  { role: 'verifier', startedAt: iso(1), num: '#101' },
  { role: 'idle', startedAt: iso(1), num: '' },
];

async function apriStatistiche(page, { dati = DATI, log = LOG } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => window.__mgTest.setData(d), dati);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  // Il registro dei worker arriva da Firestore, che negli spec non c'è: lo si
  // consegna alla pagina, che lo disegna col suo codice vero.
  await page.evaluate((l) => window.__mgTest.setWorkerLog(l), log);
  return page;
}

const numero = (page, tile) => page.locator(`#${tile} [data-num]`);

test('la scheda mostra i tre numeri chiesti: ricevuti, lavorati, prober lanciati', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  // Cinque feedback negli ultimi 30 giorni (il sesto è di 300 giorni fa).
  await expect(numero(page, 'mgStTileRicevuti')).toHaveText('5');
  // Lavorati = entrati in lavorazione almeno una volta: done, working, design
  // NON è lavorazione, ma b/d hanno note di verifica… conta lo STATO: a e b
  // sono `done`, c è `working`. d è tornato a `design` e non è più in
  // lavorazione, e è ancora in coda.
  await expect(numero(page, 'mgStTileLavorati')).toHaveText('3');
  // Due esplorazioni nella finestra (la terza è di 300 giorni fa).
  await expect(numero(page, 'mgStTileProber')).toHaveText('2');
});

test('la finestra di riferimento cambia i numeri, e «Sempre» fa rientrare il feedback vecchio', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);

  await page.locator('.mg-st-chip[data-window="7d"]').click();
  await expect(page.locator('.mg-st-chip[data-window="7d"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(numero(page, 'mgStTileRicevuti')).toHaveText('5');

  await page.locator('.mg-st-chip[data-window="all"]').click();
  await expect(numero(page, 'mgStTileRicevuti')).toHaveText('6');
  await expect(numero(page, 'mgStTileProber')).toHaveText('3');

  // «Oggi» esclude tutto: il più recente è di ieri.
  await page.locator('.mg-st-chip[data-window="today"]').click();
  await expect(numero(page, 'mgStTileRicevuti')).toHaveText('0');
  // Un numero a zero deve restare spiegato, non lasciare la pagina muta.
  await expect(page.locator('#mgStRange')).toContainText('tutti i creatori');
});

test('la finestra personalizzata si sceglie con le due date e comprende il giorno finale', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);

  await page.locator('.mg-st-chip[data-window="custom"]').click();
  await expect(page.locator('#mgStCustom')).toBeVisible();

  const giorno = (n) => {
    const d = new Date(ORA.getTime() - n * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // Dal terzo al secondo giorno fa: dentro ci sono c, d (2 giorni fa) ed e
  // (3 giorni fa) — tre feedback. Se il giorno finale non contasse per intero
  // ne uscirebbero meno.
  await page.locator('#mgStFrom').fill(giorno(3));
  await page.locator('#mgStTo').fill(giorno(2));
  await expect(numero(page, 'mgStTileRicevuti')).toHaveText('3');

  // Solo la data d'inizio: è un limite legittimo, non un errore.
  await page.locator('#mgStTo').fill('');
  await expect(numero(page, 'mgStTileRicevuti')).toHaveText('5');
  await expect(page.locator('#mgStWarn')).toBeHidden();
});

test('il filtro per creatore restringe i numeri, e «Routine cloud» prende tutte le automazioni in un clic', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  // Solo l'esplorazione: due feedback (b, c) e le due esecuzioni di prober.
  await page.locator('.mg-st-chip[data-creator="prober"]').click();
  await expect(numero(page, 'mgStTileRicevuti')).toHaveText('2');
  await expect(numero(page, 'mgStTileProber')).toHaveText('2');

  // Il gruppo rapido: esplorazione + sviluppo + verifica + residui + ignoto.
  await page.locator('.mg-st-chip[data-group="cloud"]').click();
  await expect(page.locator('.mg-st-chip[data-group="cloud"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(numero(page, 'mgStTileRicevuti')).toHaveText('3');

  // Solo le persone: le esecuzioni delle routine si azzerano, o il numero
  // contraddirebbe il filtro appena scelto.
  await page.locator('.mg-st-chip[data-group="persone"]').click();
  await expect(numero(page, 'mgStTileRicevuti')).toHaveText('2');
  await expect(numero(page, 'mgStTileProber')).toHaveText('0');

  // «Tutti» riporta indietro tutto in un clic.
  await page.locator('.mg-st-chip[data-group="tutti"]').click();
  await expect(numero(page, 'mgStTileRicevuti')).toHaveText('5');
});

test('«Feedback ricevuti» si apre sulla ripartizione per categoria, e i tre numeri si aprono allo stesso modo', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  const drawer = page.locator('#mgStDrawer');
  await expect(drawer).toBeHidden();

  await page.locator('#mgStTileRicevuti').click();
  await expect(drawer).toBeVisible();
  await expect(page.locator('#mgStTileRicevuti')).toHaveAttribute('aria-expanded', 'true');
  // Le categorie della finestra: 2 risolti, 1 in lavorazione, 1 decisione
  // owner, 1 in coda.
  await expect(drawer.locator('[data-row="done"] .mg-st-row-num')).toContainText('2');
  await expect(drawer.locator('[data-row="lavorazione"] .mg-st-row-num')).toContainText('1');
  await expect(drawer.locator('[data-row="design"] .mg-st-row-num')).toContainText('1');
  await expect(drawer.locator('[data-row="todo"] .mg-st-row-num')).toContainText('1');

  // Un secondo numero apre il SUO dettaglio e chiude il primo: due aperti
  // insieme spingerebbero i grafici fuori schermo a ogni clic.
  await page.locator('#mgStTileProber').click();
  await expect(page.locator('#mgStTileRicevuti')).toHaveAttribute('aria-expanded', 'false');
  await expect(drawer.locator('[data-row="prober"] .mg-st-row-num')).toContainText('2');
  await expect(drawer.locator('[data-row="verifier"] .mg-st-row-num')).toContainText('1');

  // «Fermo» non è lavoro: non compare fra le esecuzioni.
  await expect(drawer.locator('[data-row="idle"]')).toHaveCount(0);

  // Ricliccare lo stesso numero richiude.
  await page.locator('#mgStTileProber').click();
  await expect(drawer).toBeHidden();
});

test('la torta dei giri di verifica mostra le fette giuste, coi lavori fermati a parte', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  const torta = page.locator('#mgStLoopChart');
  // a è passato al primo colpo, b dopo una critica, d si è fermato.
  await expect(torta.locator('[data-group="loop-0"]')).toHaveCount(1);
  await expect(torta.locator('[data-group="loop-1"]')).toHaveCount(1);
  await expect(torta.locator('[data-group="fermati"]')).toHaveCount(1);
  // La legenda specchia le fette, coi numeri.
  await expect(page.locator('#mgStLoopLegend [data-group="loop-0"]')).toContainText('1');
  await expect(page.locator('#mgStLoopLegend [data-group="fermati"]')).toContainText('Fermati');

  // La media: una critica su due lavori passati = 0,5.
  await expect(page.locator('#mgStLoopAvg')).toContainText('0,5');

  // La seconda torta separa le critiche che fermano il lavoro da quelle che no:
  // due critiche «migliorabile» (b e d) e una che ferma (d).
  await expect(page.locator('#mgStOutcomeChart [data-group="fail"]')).toHaveCount(1);
  await expect(page.locator('#mgStOutcomeChart [data-group="migliorabile"]')).toHaveCount(1);
  await expect(page.locator('#mgStOutcomeLegend [data-group="fail"]')).toContainText('1');
  await expect(page.locator('#mgStOutcomeLegend [data-group="migliorabile"]')).toContainText('2');
});

test('senza lavori verificati la torta non finge: lo dice', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page, { dati: [fb({ id: 'z', seq: 1, at: iso(1), status: 'todo' })], log: [] });
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  await expect(page.locator('#mgStLoopEmpty')).toBeVisible();
  await expect(page.locator('#mgStLoopChart path')).toHaveCount(0);
  await expect(page.locator('#mgStLoopAvg')).toBeHidden();
});

test('uno stato che questo computer non sa leggere si dichiara, non finisce in una categoria a caso', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page, {
    dati: [
      fb({ id: 'x', seq: 1, at: iso(1), status: 'FENC1:blob-illeggibile' }),
      fb({ id: 'y', seq: 2, at: iso(1), status: 'done' }),
    ],
    log: [],
  });
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  await expect(numero(page, 'mgStTileRicevuti')).toHaveText('2');
  await page.locator('#mgStTileRicevuti').click();
  const drawer = page.locator('#mgStDrawer');
  await expect(drawer.locator('[data-row="illeggibili"]')).toBeVisible();
  await expect(drawer.locator('[data-row="illeggibili"] .mg-st-row-num')).toContainText('1');
  await expect(drawer.locator('[data-row="done"] .mg-st-row-num')).toContainText('1');
});
