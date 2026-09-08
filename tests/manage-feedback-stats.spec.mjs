// Spec della scheda "Statistiche feedback" della dashboard di gestione (#496).
//
// Assert di COMPORTAMENTO — cosa vede e cosa può fare l'owner:
//   - la scheda ha il suo pannello e i suoi due controlli;
//   - "Feedback ricevuti" dice quante ne sono arrivate nella finestra scelta, e
//     aprendolo si legge la ripartizione per categoria;
//   - cambiare la finestra (e scriverla a mano, dal… al…) cambia i numeri;
//   - il filtro per creatore isola le segnalazioni delle routine;
//   - la torta disegna una fetta per "quanti giri prima del pass", e sotto si
//     legge quante critiche hanno fermato il lavoro e quante hanno rimandato i
//     rilievi (i vecchi «fail» e «migliorabile»);
//   - le partenze delle routine arrivano dal registro dei worker.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const GIORNO = 24 * 3600 * 1000;

// Verbali di verifica come li scrive il server nelle note del feedback.
const PASS_SUBITO = 'Report del lavoro.\n\nVerifica superata.';
const UN_GIRO = [
  'Report del lavoro.',
  '',
  'Verifica: 1 rilievo.',
  'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
  '- [2] Il salvataggio non parte a titolo vuoto',
  '',
  '--- Aggiornamento dell\'agente del 07/09/2026, 10:00 ---',
  'Corretto.',
  '',
  'Verifica superata.',
].join('\n');
const RIMANDATI = [
  'Verifica: 1 rilievo.',
  'Nessun rilievo da correggere adesso: il lavoro prosegue e i rilievi vanno in un feedback derivato.',
  '- [1] Manca l\'hover sull\'icona',
].join('\n');
const BLOCCANTE = [
  'Verifica: 1 rilievo.',
  'Il lavoro si ferma: c\'è un rilievo di livello 2 o 3 che non si può correggere da soli (bilancio esaurito, o chiede una tua decisione).',
  '- [3] I dati dell\'utente finiscono nei log',
].join('\n');

// La lista finta: le date sono relative ad ADESSO, così la finestra scelta dal
// test vuol dire la stessa cosa su qualunque macchina.
function datiFinti() {
  const ora = Date.now();
  const iso = (giorniFa) => new Date(ora - giorniFa * 24 * 3600 * 1000).toISOString();
  const base = (over) => Object.assign({
    _id: 'x', seq: 1, subSeq: 0, clientId: 'tester@example.com',
    text: 'segnalazione di prova', status: 'todo', createdAt: iso(1),
  }, over);
  return [
    // Ricevuti dentro i 7 giorni: 3 (di cui un attacco), fuori: 1.
    base({ _id: 'r1', seq: 101, createdAt: iso(1) }),
    base({ _id: 'r2', seq: 102, createdAt: iso(2), status: 'attack' }),
    base({ _id: 'r3', seq: 103, createdAt: iso(3), clientId: 'routine:prober' }),
    base({ _id: 'r4', seq: 104, createdAt: iso(20) }),
    // Lavorazioni chiuse negli ultimi 7 giorni: 4, con quattro storie diverse.
    base({ _id: 'w1', seq: 201, status: 'done', createdAt: iso(9), _updateTime: iso(2), notes: PASS_SUBITO }),
    base({ _id: 'w2', seq: 202, status: 'done', createdAt: iso(9), _updateTime: iso(2), notes: UN_GIRO }),
    base({ _id: 'w3', seq: 203, status: 'done', createdAt: iso(9), _updateTime: iso(3), notes: RIMANDATI }),
    base({ _id: 'w4', seq: 204, status: 'done', createdAt: iso(9), _updateTime: iso(3), notes: BLOCCANTE }),
  ];
}

async function apriStatistiche(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((lista) => window.__mgTest.setData(lista), datiFintiSerializzati);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
}

// Playwright serializza gli argomenti: la lista si costruisce qui e viaggia.
let datiFintiSerializzati = [];

test.beforeEach(() => { datiFintiSerializzati = datiFinti(); });

const valore = (page, card) => page.locator(`.mg-st-card[data-card="${card}"] .mg-st-card-value`);

test('la scheda ha il suo pannello, i due controlli e i riquadri delle misure', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);

  await expect(page.locator('#panel-list')).not.toHaveClass(/mg-panel--active/);
  // Finestra: le scelte pronte più quella scritta a mano.
  await expect(page.locator('#mgStWindows .mg-st-chip')).toHaveCount(6);
  await expect(page.locator('#mgStWindows .mg-st-chip[data-window="7d"]')).toHaveText('7 giorni');
  // Creatore: "Tutti" + i due gruppi + una casella per categoria d'autore.
  await expect(page.locator('#mgStCreators .mg-st-chip[data-creator-all="1"]')).toHaveClass(/mg-st-chip--on/);
  await expect(page.locator('#mgStCreators .mg-st-chip[data-creator="prober"]')).toBeVisible();
  // I quattro riquadri chiesti.
  for (const card of ['ricevuti', 'lavorati', 'routine', 'adesso']) {
    await expect(page.locator(`.mg-st-card[data-card="${card}"]`)).toBeVisible();
  }
});

test('"Feedback ricevuti" segue la finestra e si apre sulla ripartizione per categoria', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);

  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));
  await expect(valore(page, 'ricevuti')).toHaveText('3');

  // Aperto (lo è di suo): la ripartizione per categoria si LEGGE, non è un
  // numero solo. Un attacco e due valide.
  const dettaglio = page.locator('[data-card-detail="ricevuti"]');
  await expect(dettaglio).toBeVisible();
  await expect(dettaglio).toContainText('Attacchi');
  await expect(dettaglio.locator('.mg-st-row', { hasText: 'Attacchi' }).locator('.mg-st-row-n')).toHaveText('1');

  // Finestra più larga: entra anche quella di venti giorni fa.
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await expect(valore(page, 'ricevuti')).toHaveText('4');

  // E la si può chiudere: il riquadro è un interruttore, non una porta a senso
  // unico.
  await page.locator('[data-card-toggle="ricevuti"]').click();
  await expect(dettaglio).toBeHidden();
});

test('la finestra si può scrivere a mano (dal… al…) e una data storta lo DICE', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);

  // I campi data compaiono solo con "Dal… al…" scelto.
  await expect(page.locator('#mgStCustom')).toBeHidden();
  await page.locator('#mgStWindows .mg-st-chip[data-window="custom"]').click();
  await expect(page.locator('#mgStCustom')).toBeVisible();

  // Una finestra di due giorni attorno a ieri: dentro c'è solo la segnalazione
  // di ieri e quella di due giorni fa.
  const giorni = await page.evaluate(() => {
    const iso = (g) => {
      const d = new Date(Date.now() - g * 24 * 3600 * 1000);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    return { da: iso(2), a: iso(1) };
  });
  await page.evaluate((g) => window.__mgTest.setStatsWindow('custom', g.da, g.a), giorni);
  await expect(valore(page, 'ricevuti')).toHaveText('2');
  await expect(page.locator('#mgStNote')).toContainText('Finestra: dal');

  // Date al contrario: nessuna schermata di zeri silenziosa, ma la frase che
  // dice cosa non va.
  await page.evaluate((g) => window.__mgTest.setStatsWindow('custom', g.a, g.da), giorni);
  await expect(page.locator('#mgStNote')).toContainText('non si legge');
});

test('il filtro per creatore isola le segnalazioni delle routine (e le caselle dicono quante ne hanno)', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  // La casella dell'esploratore dice "1" anche da spenta.
  await expect(page.locator('#mgStCreators .mg-st-chip[data-creator="prober"] .mg-st-chip-count')).toHaveText('1');

  await page.locator('#mgStCreators .mg-st-chip[data-creator="prober"]').click();
  await expect(valore(page, 'ricevuti')).toHaveText('1');
  await expect(page.locator('#mgStCreators .mg-st-chip[data-creator="prober"]')).toHaveClass(/mg-st-chip--on/);

  // Il gruppo "Routine" prende tutte le automazioni in un colpo; ricliccarlo lo
  // spegne (si accende e si spegne dallo stesso posto).
  await page.locator('#mgStCreators .mg-st-chip[data-creator-group="routine"]').click();
  await expect(valore(page, 'ricevuti')).toHaveText('1');
  await page.locator('#mgStCreators .mg-st-chip[data-creator-group="routine"]').click();
  await expect(valore(page, 'ricevuti')).toHaveText('3');
});

test('la torta dice quanti giri costa un lavoro, e sotto quante critiche hanno fermato o rimandato', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  // Quattro lavorazioni chiuse nella finestra.
  await expect(valore(page, 'lavorati')).toHaveText('4');

  // Tre sono passate (due al primo colpo, una dopo una correzione): due fette.
  await expect(page.locator('#mgStPie [data-group="0"]')).toHaveCount(1);
  await expect(page.locator('#mgStPie [data-group="1"]')).toHaveCount(1);
  await expect(page.locator('#mgStPieLegend li[data-group="0"] .mg-st-legend-n')).toContainText('2');
  await expect(page.locator('#mgStPieLegend li[data-group="1"] .mg-st-legend-n')).toContainText('1');

  // E si legge che tipo di critiche erano: una ha fatto correggere, una ha
  // fermato il lavoro (il vecchio «fail»), una ha rimandato i rilievi (il
  // vecchio «migliorabile»).
  const nota = page.locator('#mgStPieNote');
  await expect(nota).toContainText('1 giri di correzione');
  await expect(nota).toContainText('1 bloccanti');
  await expect(nota).toContainText('1 con rilievi rimandati');
  await expect(nota).toContainText('Media:');
});

test('le partenze delle routine arrivano dal registro dei worker, con la ripartizione per ruolo', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  await page.evaluate(() => {
    const iso = (gg) => new Date(Date.now() - gg * 24 * 3600 * 1000).toISOString();
    window.__mgTest.renderWorkerLog([
      { role: 'prober', startedAt: iso(1), num: '#1' },
      { role: 'prober', startedAt: iso(2), num: '#2' },
      { role: 'verifier', startedAt: iso(3), num: '#3' },
      { role: 'prober', startedAt: iso(40), num: '#4' },
    ]);
  }, GIORNO);

  await expect(valore(page, 'routine')).toHaveText('2');
  const dettaglio = page.locator('[data-card-detail="routine"]');
  await page.locator('[data-card-toggle="routine"]').click();
  await expect(dettaglio.locator('.mg-st-row', { hasText: 'Esplorazione' }).locator('.mg-st-row-n')).toHaveText('2');
  await expect(dettaglio.locator('.mg-st-row', { hasText: 'Verifica' }).locator('.mg-st-row-n')).toHaveText('1');

  // Il registro comincia dopo l'inizio della finestra "90 giorni": il numero è
  // un minimo, e si vede dal "+" e dalla frase.
  await page.evaluate(() => window.__mgTest.setStatsWindow('90d'));
  await expect(valore(page, 'routine')).toHaveText('3+');
  await expect(page.locator('#mgStNote')).toContainText('registro delle partenze');
});
