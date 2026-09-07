// Verifica avversariale #496, giro 6 — scheda «Statistiche feedback».
//
// Porte NUOVE (le quattro dei giri passati sono riprovate dagli spec loro):
//   1. senza la chiave dell'owner ogni stato è un blob: «Feedback lavorati»
//      scrive 0 invece di dire che non lo sa (la barra della stessa pagina, con
//      lo stesso guasto, il numero lo toglie);
//   2. con «Sempre» le barrette di «Quando arrivano» partono dall'ISTANTE del
//      feedback più vecchio, non da mezzanotte: la barretta etichettata «5
//      settembre» contiene anche gli arrivi del 6;
//   3. il tasto destro su una barretta promette «restringi la finestra a questo
//      periodo»: il numero della finestra deve ridare il numero della barretta.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const fb = (o) => ({
  _id: o.id,
  seq: o.seq,
  subSeq: 0,
  name: o.name || o.id,
  text: `Segnalazione ${o.id}`,
  clientId: o.clientId || 'utente-esterno-1',
  createdAt: o.at,
  status: o.status || 'todo',
  notes: o.notes || '',
  images: [],
  priority: o.priority || 0,
});

async function apri(page, dati, log = []) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => window.__mgTest.setData(d), dati);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate((l) => window.__mgTest.setWorkerLog(l), log);
}

const numero = (page, tile) => page.locator(`#${tile} [data-num]`);

// ── 1. Nessuna chiave: gli stati sono blob ─────────────────────────────────
test('senza la chiave dell\'owner: «Feedback lavorati» dice 0 o dice che non lo sa?', async ({ openTab }) => {
  const page = await openTab(URL);
  const ora = Date.now();
  const iso = (g) => new Date(ora - g * 86400000).toISOString();
  // Tutti gli stati cifrati: è il caso vero di chi non ha la chiave (o li legge
  // tutti, o non ne legge uno).
  const dati = [
    fb({ id: 'a', seq: 201, at: iso(1), status: 'FENCv1:blob-a' }),
    fb({ id: 'b', seq: 202, at: iso(2), status: 'FENCv1:blob-b' }),
    fb({ id: 'c', seq: 203, at: iso(3), status: 'FENCv1:blob-c' }),
  ];
  await apri(page, dati);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  await expect(numero(page, 'mgStTileRicevuti')).toHaveText('3');
  const lavorati = await numero(page, 'mgStTileLavorati').textContent();
  const sub = await page.locator('#mgStTileLavorati [data-sub]').textContent();
  const drawerDice = await page.evaluate(async () => {
    document.getElementById('mgStTileRicevuti').click();
    await new Promise((r) => setTimeout(r, 50));
    return document.getElementById('mgStDrawer').textContent;
  });
  console.log('[giro6] lavorati =', JSON.stringify(lavorati), 'sub =', JSON.stringify(sub));
  console.log('[giro6] drawer ricevuti =', JSON.stringify(drawerDice.replace(/\s+/g, ' ').trim()));
  // La barra in cima alla stessa pagina, con lo stesso guasto, il numero lo toglie.
  const barra = await page.evaluate(() => [...document.querySelectorAll('.mg-tab')]
    .map((t) => t.textContent.replace(/\s+/g, ' ').trim()));
  console.log('[giro6] barra schede =', JSON.stringify(barra));
  // Asserzione dal punto di vista dell'owner: un numero che non si conosce non
  // si scrive zero.
  expect(lavorati.trim()).not.toBe('0');
});

// ── 2 e 3. Le barrette di «Quando arrivano» con «Sempre» ───────────────────
test('«Sempre»: la barretta etichettata con un giorno contiene solo quel giorno?', async ({ openTab }) => {
  const page = await openTab(URL);
  // Il più vecchio a tarda sera, il secondo la mattina DOPO: due giorni di
  // calendario diversi, meno di 24 ore di distanza.
  const g = (giorniFa, ore, min) => {
    const d = new Date();
    d.setDate(d.getDate() - giorniFa);
    d.setHours(ore, min, 0, 0);
    return d.toISOString();
  };
  const dati = [
    fb({ id: 'v1', seq: 301, at: g(5, 23, 30), name: 'sera del quinto giorno fa' }),
    fb({ id: 'v2', seq: 302, at: g(4, 1, 0), name: 'notte del quarto giorno fa' }),
    fb({ id: 'v3', seq: 303, at: g(1, 12, 0), name: 'ieri a mezzogiorno' }),
  ];
  await apri(page, dati);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));

  const barre = await page.evaluate(() => [...document.querySelectorAll('.mg-st-spark-bar')]
    .map((b) => ({ titolo: b.getAttribute('title'), from: b.dataset.from, to: b.dataset.to, n: b.dataset.count }))
    .filter((b) => Number(b.n) > 0));
  console.log('[giro6] barrette con dati («Sempre») =', JSON.stringify(barre, null, 1));

  // La prima barretta piena: quante ne dichiara, e quante ne contiene davvero
  // la finestra che il tasto destro promette per quella barretta?
  const prima = barre[0];
  await page.evaluate(({ from, to }) => window.__mgTest.setStatsWindow('custom', from, to), prima);
  const dopo = await numero(page, 'mgStTileRicevuti').textContent();
  console.log('[giro6] barretta dichiara', prima.n, '· la sua finestra', prima.from, '→', prima.to, 'dice', dopo);
  expect(dopo.trim()).toBe(String(prima.n));
});

test('finestra ancorata a mezzanotte («Ultimi 7 giorni»): stessa prova, deve reggere', async ({ openTab }) => {
  const page = await openTab(URL);
  const g = (giorniFa, ore) => {
    const d = new Date();
    d.setDate(d.getDate() - giorniFa);
    d.setHours(ore, 30, 0, 0);
    return d.toISOString();
  };
  const dati = [
    fb({ id: 'w1', seq: 401, at: g(5, 23) }),
    fb({ id: 'w2', seq: 402, at: g(4, 1) }),
    fb({ id: 'w3', seq: 403, at: g(1, 12) }),
  ];
  await apri(page, dati);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));
  const barre = await page.evaluate(() => [...document.querySelectorAll('.mg-st-spark-bar')]
    .map((b) => ({ titolo: b.getAttribute('title'), from: b.dataset.from, to: b.dataset.to, n: b.dataset.count }))
    .filter((b) => Number(b.n) > 0));
  console.log('[giro6] barrette («7 giorni») =', JSON.stringify(barre, null, 1));
  const prima = barre[0];
  await page.evaluate(({ from, to }) => window.__mgTest.setStatsWindow('custom', from, to), prima);
  const dopo = await numero(page, 'mgStTileRicevuti').textContent();
  expect(dopo.trim()).toBe(String(prima.n));
});

// ── 4. Senza chiave: le altre sezioni ───────────────────────────────────────
test('senza la chiave: priorità e «Chi le manda» che numeri scrivono?', async ({ openTab }) => {
  const page = await openTab(URL);
  const ora = Date.now();
  const iso = (g) => new Date(ora - g * 86400000).toISOString();
  // Come arriva un documento a chi non ha la chiave: status/clientId/notes
  // sostituiti dal segnaposto, priority ancora ciphertext (scelta dichiarata).
  const CIFR = '[cifrato — chiave privata non configurata]';
  const dati = [1, 2, 3].map((n) => ({
    _id: `k${n}`, seq: 500 + n, subSeq: 0,
    name: CIFR, text: CIFR, clientId: CIFR,
    createdAt: iso(n), status: CIFR, notes: CIFR,
    images: [], priority: 'FENC1:blob-priorita',
  }));
  await apri(page, dati);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  const salute = await page.locator('#mgStHealthRows').textContent();
  const creatori = await page.locator('#mgStCreatorRows').textContent();
  console.log('[giro6] salute della coda =', JSON.stringify(salute.replace(/\s+/g, ' ').trim()));
  console.log('[giro6] chi le manda    =', JSON.stringify(creatori.replace(/\s+/g, ' ').trim()));
  await page.screenshot({ path: 'tests/.shots/496-giro6-senza-chiave.png', fullPage: true });
});

test('foto: la scheda piena, tema chiaro', async ({ openTab }) => {
  const page = await openTab(URL);
  const ora = Date.now();
  const iso = (g) => new Date(ora - g * 86400000).toISOString();
  const T = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";
  const PASS = 'Verifica superata. Provato tutto.';
  const CRIT = 'Verifica: 2 rilievi.\nIl verificatore corregge tutti i rilievi; poi un altro verificatore ricontrolla.\n- [1] x';
  const dati = [
    fb({ id: 'p1', seq: 601, at: iso(1), status: 'done', clientId: 'routine:prober', notes: `R.${T}${CRIT}${T}${PASS}`, priority: 3 }),
    fb({ id: 'p2', seq: 602, at: iso(2), status: 'done', clientId: 'owner:pino', notes: `R.${T}${PASS}`, priority: 2 }),
    fb({ id: 'p3', seq: 603, at: iso(3), status: 'todo', clientId: 'utente-x', priority: 1 }),
    fb({ id: 'p4', seq: 604, at: iso(4), status: 'working', clientId: 'routine:fixer' }),
  ];
  await apri(page, dati, [
    { role: 'prober', startedAt: iso(1), num: '' },
    { role: 'verifier', startedAt: iso(1), num: '#601' },
  ]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.screenshot({ path: 'tests/.shots/496-giro6-piena.png', fullPage: true });
});
