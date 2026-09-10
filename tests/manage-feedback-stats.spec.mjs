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

  // Finestra più larga: entrano anche quella di venti giorni fa e le quattro
  // lavorazioni, che sono arrivate nove giorni fa.
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await expect(valore(page, 'ricevuti')).toHaveText('8');

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
  await expect(nota).toContainText('1 giro di correzione');
  await expect(nota).toContainText('1 giro bloccante, passato all’owner');
  await expect(nota).toContainText('1 giro con rilievi rimandati');
  await expect(nota).toContainText('Media:');
});

test('senza la chiave dell\'owner i numeri che nascono dallo stato NON si scrivono (né uno zero)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  // Stato cifrato: su questo computer non si scioglie.
  await page.evaluate(() => {
    const iso = (g) => new Date(Date.now() - g * 24 * 3600 * 1000).toISOString();
    window.__mgTest.setData([
      { _id: 'c1', seq: 301, clientId: 'tester@example.com', text: 'x', status: 'FENC1:aaa', createdAt: iso(1) },
      { _id: 'c2', seq: 302, clientId: 'tester@example.com', text: 'y', status: 'FENC1:bbb', createdAt: iso(2) },
    ]);
  });
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  // Quante ne sono arrivate si sa (la data e il mittente sono in chiaro)…
  await expect(valore(page, 'ricevuti')).toHaveText('2');
  // …quante ne sono state lavorate no: un "0" qui direbbe "nessuna" dove la
  // verità è "non lo sappiamo".
  await expect(valore(page, 'lavorati')).toHaveText('—');
  await expect(valore(page, 'adesso')).toHaveText('—');
  await expect(page.locator('#mgStNote')).toContainText('non può leggere lo stato');
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
  });

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

// ─── Le guardie del giro 7 ───────────────────────────────────────────────────
// Il colore che dice se il numero è buono, la strada dal numero alle
// segnalazioni contate, e il trattino al posto di uno zero che non si sa.

const VERDE_DEL_PASS = 'rgb(59, 191, 122)';

function verbaleConGiri(n) {
  const b = [];
  for (let i = 0; i < n; i += 1) {
    b.push(
      'Verifica: 1 rilievo.',
      'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
      '- [1] Un rilievo qualunque',
      '',
      `--- Aggiornamento dell'agente del 0${i + 1}/09/2026, 10:00 ---`,
      'Corretto.',
      '',
    );
  }
  b.push('Verifica superata.');
  return b.join('\n');
}

test('il colore della fetta segue il numero di critiche, non la posizione nell’elenco', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  const lavori = (giri) => giri.map((g, i) => ({
    _id: `g${i}`, seq: 900 + i, subSeq: 0, clientId: 'tester@example.com', text: 't',
    status: 'done',
    createdAt: new Date(Date.now() - 9 * 86400000).toISOString(),
    _updateTime: new Date(Date.now() - 2 * 86400000).toISOString(),
    notes: verbaleConGiri(g),
  }));

  // Una fetta sola, e non è quella dei pass immediati: non può prendere il
  // verde di «passata subito».
  await page.evaluate((l) => window.__mgTest.setData(l), lavori([5]));
  await page.evaluate(() => window.__mgTest.renderStats());
  const swatch = page.locator('#mgStPieLegend li').first().locator('.mg-st-swatch');
  await expect(page.locator('#mgStPieLegend li').first()).toContainText('5 critiche');
  expect(await swatch.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(VERDE_DEL_PASS);

  // Lo stesso numero di critiche tiene il suo colore anche quando accanto
  // compaiono altre fette.
  await page.evaluate((l) => window.__mgTest.setData(l), lavori([2, 5]));
  await page.evaluate(() => window.__mgTest.renderStats());
  const colore2 = await page.locator('#mgStPieLegend li', { hasText: '2 critiche' })
    .locator('.mg-st-swatch').evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.evaluate((l) => window.__mgTest.setData(l), lavori([0, 2, 5]));
  await page.evaluate(() => window.__mgTest.renderStats());
  const colore2dopo = await page.locator('#mgStPieLegend li', { hasText: '2 critiche' })
    .locator('.mg-st-swatch').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(colore2dopo).toBe(colore2);
  expect(colore2).not.toBe(VERDE_DEL_PASS);
});

test('da una ripartizione si apre l’elenco delle segnalazioni contate e da lì la segnalazione', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  const riga = page.locator('[data-card-detail="ricevuti"] [data-drill="categoria:attacco"]');
  await expect(riga).toHaveCount(1);
  await riga.click();
  const elenco = page.locator('#panel-fbstats .mg-st-drill');
  await expect(elenco).toBeVisible();
  await expect(elenco.locator('.mg-st-drill-item')).toHaveCount(1);
  await expect(elenco.locator('.mg-st-drill-item').first()).toContainText('#102');

  // E da lì si arriva alla segnalazione vera.
  await elenco.locator('.mg-st-drill-item').first().click();
  await expect(page.locator('#panel-list')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#mgDetail')).toBeVisible();
});

test('anche la voce di legenda della torta apre i lavori che ha contato', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  const voce = page.locator('#mgStPieLegend [data-drill="giri:0"]');
  await expect(voce).toHaveCount(1);
  await voce.click();
  // I due lavori della lista finta passati al primo giro: quello superato
  // subito e quello coi rilievi rimandati (che prosegue anche lui).
  const voci = page.locator('#panel-fbstats .mg-st-drill .mg-st-drill-item');
  await expect(voci).toHaveCount(2);
  await expect(voci.first()).toContainText('#2');
});

test('senza i feedback in pagina i numeri sono trattini e la scheda dice perché', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));
  await expect(valore(page, 'ricevuti')).toHaveText('3');

  // Il caricamento va male mentre la scheda è aperta e mostra i suoi numeri.
  await page.evaluate(() => window.__mgTest.simulaCaricamentoFallito());
  await expect(valore(page, 'ricevuti')).toHaveText('—');
  await expect(valore(page, 'lavorati')).toHaveText('—');
  await expect(page.locator('#mgStNote')).toContainText('non si sono caricati');
});

test('«Prober lanciati» scrive un trattino finché il registro non è arrivato', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));
  // Nel contenitore la sessione non è quella dell'owner: il registro è
  // riservato, quindi quel numero non si conosce.
  await expect(valore(page, 'routine')).toHaveText('—');
  await expect(page.locator('#mgStNote')).toContainText('registro delle partenze');
});

test('una conversazione tagliata dal tetto non finisce nella fetta verde in silenzio', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => {
    const TRIM = window.SN_FEEDBACK_THREAD.TRIM_MARK;
    window.__mgTest.setData([{
      _id: 't1', seq: 950, subSeq: 0, clientId: 'tester@example.com', text: 't',
      status: 'done',
      createdAt: new Date(Date.now() - 9 * 86400000).toISOString(),
      _updateTime: new Date(Date.now() - 2 * 86400000).toISOString(),
      notes: `${TRIM}\n\nVerifica superata.`,
    }]);
    window.__mgTest.setStatsWindow('30d');
  });
  await expect(page.locator('#mgStPieLegend')).not.toContainText('Passata subito');
  await expect(page.locator('#panel-fbstats')).toContainText('conversazione tagliata');
});
