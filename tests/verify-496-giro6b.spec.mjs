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

test('«Sempre»: il menu della barretta promette un giorno e ne applica due?', async ({ openTab }) => {
  const page = await openTab(URL);
  const g = (giorniFa, ore, min) => {
    const d = new Date();
    d.setDate(d.getDate() - giorniFa);
    d.setHours(ore, min, 0, 0);
    return d.toISOString();
  };
  const mk = (id, seq, at) => ({
    _id: id, seq, subSeq: 0, name: id, text: 't', clientId: 'owner:pino',
    createdAt: at, status: 'todo', notes: '', images: [], priority: 0,
  });
  // Il più vecchio la sera; poi uno la notte dopo e uno la sera dopo ancora:
  // tre giorni di calendario distinti.
  const dati = [
    mk('s1', 1001, g(5, 23, 30)),
    mk('s2', 1002, g(4, 1, 0)),
    mk('s3', 1003, g(4, 20, 0)),
  ];
  await apri(page, dati);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  const barre = await page.evaluate(() => [...document.querySelectorAll('.mg-st-spark-bar')]
    .map((b) => ({ quando: b.dataset.quando, from: b.dataset.from, to: b.dataset.to, n: b.dataset.count }))
    .filter((b) => Number(b.n) > 0));
  console.log('[giro6b] «Sempre», barrette =', JSON.stringify(barre));
  const p = barre[0];
  await page.evaluate(({ from, to }) => window.__mgTest.setStatsWindow('custom', from, to), p);
  const dopo = await numero(page, 'mgStTileRicevuti').textContent();
  console.log('[giro6b] la barretta dice', p.n, 'per il periodo', JSON.stringify(p.quando),
    '· la finestra che il menu applica', p.from, '→', p.to, 'ne conta', dopo.trim());
  expect(dopo.trim()).toBe(String(p.n));
});

test('senza chiave, dal numero alla segnalazione: dove porta il clic?', async ({ openTab }) => {
  const page = await openTab(URL);
  const dati = [1, 2].map((n) => ({
    _id: `u${n}`, seq: 1100 + n, subSeq: 0,
    name: CIFR, text: CIFR, clientId: CIFR,
    createdAt: iso(n), status: CIFR, notes: CIFR, images: [], priority: 0,
  }));
  await apri(page, dati);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  const tabVisibili = await page.evaluate(() => [...document.querySelectorAll('.mg-tab')]
    .filter((t) => t.offsetParent !== null).map((t) => t.dataset.tab));
  console.log('[giro6b] schede visibili senza chiave =', JSON.stringify(tabVisibili));
  await page.locator('#mgStTileRicevuti').click();
  const riga = page.locator('#mgStDrawer .mg-st-row[data-row="illeggibili"]');
  console.log('[giro6b] riga «Stato non leggibile» presente:', await riga.count());
  if (await riga.count()) {
    await riga.click();
    const item = page.locator('#mgStDrawer .mg-st-item[data-id]').first();
    console.log('[giro6b] elenco aperto, prima voce =', JSON.stringify((await item.textContent() || '').trim()));
    await item.click();
    await page.waitForTimeout(300);
    const attiva = await page.evaluate(() => {
      const t = document.querySelector('.mg-tab--active');
      const p = document.querySelector('.mg-panel--active');
      return { tab: t ? t.dataset.tab : null, panel: p ? p.id : null,
        dettaglio: !document.getElementById('mgDetail').hidden };
    });
    console.log('[giro6b] dopo il clic =', JSON.stringify(attiva));
  }
  await page.screenshot({ path: 'tests/.shots/496-giro6b-senza-chiave-clic.png', fullPage: true });
});

test('«Sempre» vuol dire sempre? un feedback senza data, e uno con una data storta', async ({ openTab }) => {
  const page = await openTab(URL);
  const mk = (id, seq, at) => ({
    _id: id, seq, subSeq: 0, name: id, text: 't', clientId: 'owner:pino',
    createdAt: at, status: 'todo', notes: '', images: [], priority: 0,
  });
  const dati = [
    mk('d1', 1201, iso(1)),
    mk('d2', 1202, iso(2)),
    mk('senzaData', 1203, null),
    mk('dataStorta', 1204, 'non è una data'),
  ];
  await apri(page, dati);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  const ric = (await numero(page, 'mgStTileRicevuti').textContent()).trim();
  const barra = await page.evaluate(() => {
    const t = document.querySelector('.mg-tab[data-tab="inbox"]');
    return t ? t.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  const testo = await page.locator('#panel-fbstats').innerText();
  console.log('[giro6b] «Sempre» ricevuti =', ric, '· in coda (barra) =', JSON.stringify(barra));
  console.log('[giro6b] la scheda dice qualcosa sulle date mancanti?',
    /senza data|data mancante|data non/i.test(testo));
  // Quattro feedback esistono; «Sempre» non ha limiti: deve contarli tutti, o
  // dire quanti ne ha lasciati fuori.
  expect(ric).toBe('4');
});
