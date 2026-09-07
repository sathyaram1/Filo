// Verifica avversariale #496, giro 6 (seconda parte).
//
//   5. il filtro per creatore su documenti che questo computer non sa leggere:
//      «Routine cloud» dà tre zeri senza dire perché;
//   6. la chiave c'è ma UN documento non si decifra: «Feedback lavorati» e le
//      priorità lo perdono in silenzio, mentre le torte lo dichiarano;
//   7. la seconda torta ha un nome («Esito delle critiche») che sta solo
//      nell'etichetta per i lettori di schermo: sullo schermo non c'è.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const CIFR = '[cifrato — chiave privata non configurata]';

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
const ora = Date.now();
const iso = (g) => new Date(ora - g * 86400000).toISOString();

test('senza chiave, il filtro per creatore: «Routine cloud» che risposta dà?', async ({ openTab }) => {
  const page = await openTab(URL);
  const dati = [1, 2, 3].map((n) => ({
    _id: `c${n}`, seq: 700 + n, subSeq: 0,
    name: CIFR, text: CIFR, clientId: CIFR,
    createdAt: iso(n), status: CIFR, notes: CIFR, images: [], priority: 0,
  }));
  await apri(page, dati);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('.mg-st-chip[data-group="cloud"]').click();
  const ric = await numero(page, 'mgStTileRicevuti').textContent();
  const riga = await page.locator('#mgStRange').textContent();
  const creatori = await page.locator('#mgStCreatorRows').textContent();
  const vuoto = await page.locator('#mgStCreatorEmpty').isVisible();
  console.log('[giro6b] «Routine cloud» → ricevuti =', JSON.stringify(ric.trim()));
  console.log('[giro6b] riga sotto i filtri =', JSON.stringify(riga.replace(/\s+/g, ' ').trim()));
  console.log('[giro6b] chi le manda =', JSON.stringify(creatori.replace(/\s+/g, ' ').trim()), '· vuoto visibile:', vuoto);
  const testoPagina = await page.locator('#panel-fbstats').innerText();
  console.log('[giro6b] la scheda nomina la cifratura?',
    /cifrat|non le sa leggere|non leggibile/i.test(testoPagina));
});

test('chiave presente, UN documento illeggibile: chi lo dice e chi lo perde', async ({ openTab }) => {
  const page = await openTab(URL);
  const T = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";
  const PASS = 'Verifica superata. Provato tutto.';
  const base = (o) => ({
    _id: o.id, seq: o.seq, subSeq: 0, name: o.id, text: 't',
    clientId: o.clientId || 'owner:pino', createdAt: o.at,
    status: o.status, notes: o.notes || '', images: [], priority: o.priority || 0,
  });
  const dati = [
    base({ id: 'ok1', seq: 801, at: iso(1), status: 'done', notes: `R.${T}${PASS}`, priority: 3 }),
    base({ id: 'ok2', seq: 802, at: iso(2), status: 'todo', priority: 3 }),
    // Uno solo non si decifra: status/clientId segnaposto, priority ciphertext.
    { _id: 'ko', seq: 803, subSeq: 0, name: CIFR, text: CIFR, clientId: CIFR,
      createdAt: iso(3), status: CIFR, notes: CIFR, images: [], priority: 'FENC1:blob' },
  ];
  await apri(page, dati);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  console.log('[giro6b] ricevuti =', (await numero(page, 'mgStTileRicevuti').textContent()).trim());
  console.log('[giro6b] lavorati =', (await numero(page, 'mgStTileLavorati').textContent()).trim(),
    '· sub =', (await page.locator('#mgStTileLavorati [data-sub]').textContent()).trim());
  console.log('[giro6b] priorità =', (await page.locator('#mgStHealthRows').textContent()).replace(/\s+/g, ' ').trim());
  console.log('[giro6b] chi le manda =', (await page.locator('#mgStCreatorRows').textContent()).replace(/\s+/g, ' ').trim());
  const nota = page.locator('#mgStLoopUnreadable');
  console.log('[giro6b] nota delle torte visibile:', await nota.isVisible(), '·',
    (await nota.textContent()).replace(/\s+/g, ' ').trim());
});

test('la seconda torta: il suo nome si legge sullo schermo?', async ({ openTab }) => {
  const page = await openTab(URL);
  const T = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";
  const CRIT = 'Verifica: 1 rilievo.\nIl verificatore corregge tutti i rilievi; poi un altro verificatore ricontrolla.\n- [1] x';
  const PASS = 'Verifica superata.';
  const dati = [{
    _id: 'z1', seq: 901, subSeq: 0, name: 'z1', text: 't', clientId: 'owner:pino',
    createdAt: iso(1), status: 'done', notes: `R.${T}${CRIT}${T}${PASS}`, images: [], priority: 0,
  }];
  await apri(page, dati);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  const testo = await page.locator('#mgStLoopSection').innerText();
  console.log('[giro6b] testo della sezione torte =', JSON.stringify(testo.replace(/\s+/g, ' ').trim()));
  // Il nome della seconda torta è scritto solo nell'aria-label dell'SVG.
  const aria = await page.locator('#mgStOutcomeChart').getAttribute('aria-label');
  console.log('[giro6b] aria-label seconda torta =', JSON.stringify(aria));
  expect(testo).toContain(aria);
});
