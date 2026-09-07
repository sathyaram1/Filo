// Verifica avversariale #496, terzo giro — scheda «Statistiche feedback».
//
// Due filoni:
//  A) le porte trovate nei giri 1 e 2 si riprovano una a una (una regressione
//     lì vale più di un difetto nuovo);
//  B) porte nuove, cercate sulla stessa causa del giro 2 («il numero fermo
//     mentre la cosa si muove»): il giro 2 l'ha chiusa per i FEEDBACK; qui si
//     guarda l'altra sorgente della stessa riga di numeri, il registro delle
//     esecuzioni dei prober.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const PASS = 'Verifica superata. Provato tutto.';
const TURNO = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";
// N giri di verifica con una critica ciascuno, come li scrive il verificatore.
const CRIT = (n) => Array.from({ length: n }, () => `${TURNO}Verifica: 1 rilievo. Il verificatore corregge.`).join('');

const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0, name: o.name || o.id, text: o.text || `Segnalazione ${o.id}`,
  clientId: o.clientId || 'utente-esterno-1', createdAt: o.at,
  status: o.status || 'todo', notes: o.notes || '', images: [], priority: o.priority || 0,
  _updateTime: o.v || 't1',
});

const TRE = [
  fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: `R.${TURNO}${PASS}` }),
  fb({ id: 'b', seq: 2, at: iso(1) }),
  fb({ id: 'c', seq: 3, at: iso(2), status: 'working' }),
];

async function pronta(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
}

const nRicevuti = (page) => page.locator('#mgStTileRicevuti [data-num]');
const nProber = (page) => page.locator('#mgStTileProber [data-num]');
const subProber = (page) => page.locator('#mgStTileProber [data-sub]');

// Sostituisce SOLO la risposta al registro delle esecuzioni; tutto il resto
// (auth, decifratura…) continua a passare al canale vero. Il numero di
// richieste è contato, così si vede se la scheda lo rilegge o no.
async function stubRegistro(page) {
  await page.evaluate(() => {
    const vero = window.filo.message.bind(window.filo);
    window.__reg = { chiamate: 0, entries: [], fail: null };
    window.filo.message = (msg) => {
      if (msg && msg.type === 'worker_log_get') {
        window.__reg.chiamate += 1;
        if (window.__reg.fail) return Promise.resolve({ ok: false, error: window.__reg.fail });
        return Promise.resolve({ ok: true, entries: window.__reg.entries.slice() });
      }
      return vero(msg);
    };
  });
}
const run = (ruolo, g) => ({ role: ruolo, startedAt: new Date(ORA.getTime() - g * 86400000).toISOString(), num: '#1' });

async function apriStats(page) {
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
}

// ══ B) PORTE NUOVE — il registro delle esecuzioni ═════════════════════════

test('il numero dei prober segue le esecuzioni che partono mentre la scheda è aperta', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await stubRegistro(page);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((d) => window.__mgTest.setData(d), TRE);
  await page.evaluate((r) => { window.__reg.entries = r; }, [run('prober', 1), run('resolver', 1)]);

  await apriStats(page);
  await expect(nProber(page)).toHaveText('1');

  // Mentre la scheda resta aperta partono due prober nuovi, e intanto arriva
  // anche un feedback. Il feedback la scheda lo vede (giro 2); l'esecuzione?
  await page.evaluate((r) => { window.__reg.entries = r; },
    [run('prober', 1), run('resolver', 1), run('prober', 0), run('prober', 0)]);
  await page.evaluate((d) => window.__mgTest.setData(d),
    [...TRE, fb({ id: 'd', seq: 4, at: iso(0) })]);

  await expect(nRicevuti(page)).toHaveText('4');   // i feedback sì
  await expect(nProber(page)).toHaveText('3');      // e le esecuzioni?
});

test('quando il registro delle esecuzioni non si legge, il suo numero non si scrive zero', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await stubRegistro(page);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((d) => window.__mgTest.setData(d), TRE);
  await page.evaluate(() => { window.__reg.fail = 'non raggiungibile'; });

  await apriStats(page);
  // Le altre due tessere, con lo stesso guasto, scrivono «—»: qui uno zero si
  // legge come «non è partito niente», che è il contrario di «non lo so».
  await expect(nProber(page)).not.toHaveText('0');
  await expect(subProber(page)).not.toHaveText(/^0 esecuzioni/);
});

// ══ A) LE PORTE DEI GIRI PASSATI ══════════════════════════════════════════

test('giro 2: i feedback che arrivano a scheda aperta arrivano anche ai numeri', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await apriStats(page);
  await expect(page.locator('#mgStNoData')).toBeVisible();
  await expect(nRicevuti(page)).toHaveText('—');
  await page.evaluate((d) => window.__mgTest.setData(d), TRE);
  await expect(nRicevuti(page)).toHaveText('3');
  await expect(page.locator('#mgStNoData')).toBeHidden();
});

test('giro 2: un caricamento che va male a scheda aperta toglie i numeri invece di lasciarli lì', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), TRE);
  await apriStats(page);
  await expect(nRicevuti(page)).toHaveText('3');
  await page.evaluate(() => window.__mgTest.simulaCaricamentoFallito());
  await expect(nRicevuti(page)).toHaveText('—');
  await expect(page.locator('#mgStBody')).toBeHidden();
});

test('giro 1: il colore della fetta dice quante critiche, non in che ordine è capitata', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  // Nessun lavoro passato al primo colpo: solo dopo 2 e dopo 3 critiche.
  const soloAlti = [
    fb({ id: 'x', seq: 10, at: iso(1), status: 'done', notes: `R.${CRIT(2)}${TURNO}${PASS}` }),
    fb({ id: 'y', seq: 11, at: iso(1), status: 'done', notes: `R.${CRIT(3)}${TURNO}${PASS}` }),
  ];
  await page.evaluate((d) => window.__mgTest.setData(d), soloAlti);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  const fetta = page.locator('#mgStLoopChart [data-group="loop-2"]');
  await expect(fetta).toHaveCount(1);
  const soloAltiColore = await fetta.getAttribute('fill');

  // Ora la finestra comprende anche un lavoro passato subito: la fetta «2
  // critiche» non deve cambiare colore.
  await page.evaluate((d) => window.__mgTest.setData(d), [
    ...soloAlti,
    fb({ id: 'z', seq: 12, at: iso(1), status: 'done', notes: `R.${TURNO}${PASS}` }),
  ]);
  await expect(page.locator('#mgStLoopChart [data-group="loop-0"]')).toHaveCount(1);
  expect(await fetta.getAttribute('fill')).toBe(soloAltiColore);
  // …e non deve essere il verde di «passato senza critiche».
  expect(soloAltiColore).not.toBe(await page.locator('#mgStLoopChart [data-group="loop-0"]').getAttribute('fill'));
});

test('giro 1: su «Sempre» la riga dice ancora da quando il registro esiste', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), TRE);
  await page.evaluate((r) => window.__mgTest.setWorkerLog(r), [run('prober', 3)]);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await expect(page.locator('#mgStRange')).toContainText('esecuzioni sono registrate dal');
});

test('giro 1 e 2: da un numero si arriva alle segnalazioni, e il tasto destro risponde', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), TRE);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  await page.locator('#mgStTileRicevuti').click();
  const riga = page.locator('#mgStDrawer .mg-st-row[data-open]').first();
  await riga.click();
  await expect(page.locator('#mgStDrawer .mg-st-item').first()).toBeVisible();

  const menu = page.locator('.mg-ctxmenu');
  await page.locator('#mgStLoopChart [data-group]').first().click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.mg-st-spark-bar').first().click({ button: 'right' });
  await expect(menu).toContainText('Restringi la finestra a questo periodo');
  await page.keyboard.press('Escape');
});

test('giro 2: il grafico degli arrivi non promette periodi che non sono ancora successi', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), TRE);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '1900-01-01', ''));
  const riga = await page.locator('#mgStRange').textContent();
  const asse = await page.locator('#mgStSparkAxis span').last().textContent();
  const anno = (s) => Number(String(s).match(/(\d{4})/g).pop());
  expect(anno(asse)).toBeLessThanOrEqual(new Date().getFullYear());
  expect(riga).toBeTruthy();
});

test('giro 2: «Personalizzata» senza date dice cosa stai guardando, non che hai sbagliato', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), TRE);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '', ''));
  await expect(page.locator('#mgStWarn')).toBeVisible();
  await expect(page.locator('#mgStWarn')).not.toContainText('Scegli almeno');
  await expect(nRicevuti(page)).toHaveText('3');
});

test('giro 1: lo stato vuoto non lascia rettangoli né frasi tagliate', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate(() => window.__mgTest.setData([]));
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('1d'));
  await expect(page.locator('#mgStPies')).toBeHidden();
  await expect(page.locator('#mgStLoopEmpty')).toBeVisible();
  const quante = await page.locator('#panel-fbstats').evaluate((p) =>
    [...p.querySelectorAll('*')].filter((e) => e.children.length === 0
      && /Nessun feedback in questa finestra/.test(e.textContent || '')).length);
  expect(quante).toBeLessThanOrEqual(1);
});

// ══ Stress ════════════════════════════════════════════════════════════════

test('titoli con HTML e testo lunghissimo non vengono eseguiti né spezzano la scheda', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'h1', seq: 20, at: iso(1), name: '<img src=x onerror="window.__bum=1">', status: 'done', notes: `R.${TURNO}${PASS}` }),
    fb({ id: 'h2', seq: 21, at: iso(1), name: 'A'.repeat(10000) }),
    fb({ id: 'h3', seq: 22, at: iso(1), name: '🙂"\'`&<script>window.__bum2=1</script>' }),
  ]);
  await apriStats(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('#mgStTileRicevuti').click();
  await page.locator('#mgStDrawer .mg-st-row[data-open]').first().click();
  await expect(page.locator('#mgStDrawer .mg-st-item').first()).toBeVisible();
  expect(await page.evaluate(() => !!(window.__bum || window.__bum2))).toBe(false);
  // Nessuna barra orizzontale a causa di un titolo lungo 10.000 caratteri.
  const sborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(sborda).toBe(false);
});

test('cambi di finestra a raffica e doppio clic sulle tessere non lasciano la scheda incoerente', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), TRE);
  await apriStats(page);
  for (const w of ['1d', '7d', '30d', '90d', '365d', 'all', '30d', '7d', 'all', '30d']) {
    await page.evaluate((k) => window.__mgTest.setStatsWindow(k), w);
  }
  await page.locator('#mgStTileRicevuti').dblclick();
  await page.locator('#mgStTileLavorati').dblclick();
  await page.locator('#mgStTileProber').dblclick();
  await expect(nRicevuti(page)).toHaveText('3');
  const errori = await page.evaluate(() => document.body.innerText.includes('NaN')
    || document.body.innerText.includes('undefined'));
  expect(errori).toBe(false);
});
