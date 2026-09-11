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
// ⚠️ OGNI NOTA È UN TURNO. Filo appende una nota per volta, col suo
// marcatore: il report di chi lavora e il verbale del verificatore non
// stanno mai nello stesso turno.
const TURNO = (h) => `--- Aggiornamento dell'agente del 07/09/2026, ${h}:00 ---`;
const PASS_SUBITO = `Report del lavoro.\n\n${TURNO('09')}\nVerifica superata.`;
const UN_GIRO = [
  'Report del lavoro.',
  '',
  TURNO('09'),
  'Verifica: 1 rilievo.',
  'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
  '- [2] Il salvataggio non parte a titolo vuoto',
  '',
  TURNO('10'),
  'Corretto.',
  '',
  TURNO('11'),
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

// ⚠️ LE ORE CRESCONO, COME CRESCONO DAVVERO. Filo appende un turno dopo
// l'altro, quindi l'istante nel marcatore non torna mai indietro; un marcatore
// più vecchio del turno prima è la copia che qualcuno ha incollato, e la scheda
// lo tratta da citazione (#496, giro 13). Una conversazione finta con le ore
// mescolate raccontava una conversazione che Filo non scrive.
function verbaleConGiri(n) {
  const b = [];
  let ora = 0;
  const prossimoTurno = () => TURNO(String((ora += 1)).padStart(2, '0'));
  for (let i = 0; i < n; i += 1) {
    if (i) b.push(prossimoTurno());
    b.push(
      'Verifica: 1 rilievo.',
      'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
      '- [1] Un rilievo qualunque',
      '',
      prossimoTurno(),
      'Corretto.',
      '',
    );
  }
  if (n) b.push(prossimoTurno());
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

test('il tasto destro su un numero offre le sue azioni, non il menu generale della pagina', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  await page.locator('[data-card-detail="ricevuti"] [data-drill="categoria:attacco"]')
    .click({ button: 'right' });
  const menu = page.locator('.mg-ctxmenu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText(/Mostra l[ae] segnalazion/);
  await expect(menu).toContainText('Copia riga e numero');

  // La voce apre lo stesso elenco del clic sinistro.
  await menu.locator('.sn-select-option', { hasText: /Mostra l[ae] segnalazion/ }).click();
  await expect(page.locator('#panel-fbstats .mg-st-drill .mg-st-drill-item')).toHaveCount(1);

  // E la barretta del grafico offre la sua, che è restringere la finestra.
  // Il grafico sta sotto la piega: si porta in vista PRIMA, perché lo
  // scorrimento chiude il menu (come chiuderebbe qualunque menu contestuale).
  const barra = page.locator('#mgStBars rect.mg-st-bar').first();
  await barra.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await barra.click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toContainText('Restringi la finestra');
});

test('ogni superficie che porta un numero risponde al tasto destro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  const menu = page.locator('.mg-ctxmenu');
  // Il numero grande in cima a una tessera: è il numero più in vista della
  // pagina, e prima non offriva niente.
  await page.locator('.mg-st-card[data-card="ricevuti"] .mg-st-card-head').click({ button: 'right' });
  await expect(menu).toContainText(/Mostra l[ae] segnalazion/);
  await menu.locator('.sn-select-option', { hasText: /Mostra l[ae] segnalazion/ }).click();
  await expect(page.locator('.mg-st-card[data-card="ricevuti"] .mg-st-drill-item')).toHaveCount(3);

  // La pastiglia di un creatore porta il suo conteggio: il tasto destro dice quali.
  await page.locator('#mgStCreators .mg-st-chip[data-creator="prober"]').click({ button: 'right' });
  await expect(menu).toContainText(/Mostra l[ae] segnalazion/);
  await page.keyboard.press('Escape');

  // La pastiglia della finestra: si porta via il periodo vero, con le date.
  await page.locator('#mgStWindows .mg-st-chip[data-window="7d"]').click({ button: 'right' });
  await expect(menu).toContainText('Copia il periodo');
  await page.keyboard.press('Escape');

  // Una riga di «Altre misure» che conta segnalazioni: si apre come le altre.
  const riga = page.locator('#mgStMore [data-drill="misura:bloccate"]');
  await riga.scrollIntoViewIfNeeded();
  await riga.click();
  await expect(page.locator('#mgStMore .mg-st-drill-item')).toHaveCount(1);

  // E una che conta altro (le durate) almeno si copia.
  const durata = page.locator('#mgStMore [data-copia]').first();
  await durata.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await durata.click({ button: 'right' });
  await expect(menu).toContainText('Copia riga e numero');
});

// ⚠️ UNA RIGA CHE SI APRE DEVE APRIRE QUELLO CHE HA CONTATO.
// «Giri di verifica registrati» contava i giri e apriva le lavorazioni su cui
// erano successi: la riga diceva 5 e l'elenco aveva due voci, mentre il tasto
// destro prometteva «le segnalazioni contate». Il numero dei giri adesso ha una
// riga sua, che si copia e basta.
test('in «Altre misure» il numero di una riga che si apre è quante voci ha l’elenco', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  // Solo le righe il cui valore è un numero secco: «13 g» è una durata, e
  // nessuno si aspetta tredici voci sotto una durata.
  const righe = page.locator('#mgStMore .mg-st-more-riga--apre');
  const quante = await righe.count();
  expect(quante).toBeGreaterThan(0);
  let provate = 0;
  for (let i = 0; i < quante; i += 1) {
    const riga = righe.nth(i);
    const testo = (await riga.locator('.mg-st-more-value').textContent()).trim();
    if (!/^\d+$/.test(testo)) continue;
    provate += 1;
    const etichetta = (await riga.locator('.mg-st-more-label').textContent()).trim();
    await riga.scrollIntoViewIfNeeded();
    await riga.click();
    await expect(page.locator('#mgStMore .mg-st-drill')).toHaveCount(1);
    await expect(page.locator('#mgStMore .mg-st-drill-item'), etichetta).toHaveCount(Number(testo));
    await riga.click();   // richiudi, o l'elenco resta sotto la riga dopo
  }
  expect(provate, 'nessuna riga con un numero secco: la prova non ha provato niente').toBeGreaterThan(0);
});

test('anche le righe per ruolo e le frasi sotto i grafici si copiano', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));
  await page.evaluate(() => {
    const iso = (gg) => new Date(Date.now() - gg * 24 * 3600 * 1000).toISOString();
    window.__mgTest.renderWorkerLog([
      { role: 'prober', startedAt: iso(1), num: '#1' },
      { role: 'verifier', startedAt: iso(2), num: '#2' },
    ]);
  });
  await page.locator('[data-card-toggle="routine"]').click();

  const menu = page.locator('.mg-ctxmenu');
  // Le righe della ripartizione per ruolo contano partenze, non segnalazioni:
  // elenco non ne hanno, ma il tasto destro deve poterle copiare. Prima lì
  // usciva il menu generale della pagina, quello che compare su uno spazio
  // bianco.
  for (const sel of [
    '[data-card-detail="routine"] .mg-st-row',
    '#mgStPieNote',
    '#mgStBarsNote',
  ]) {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);
    await el.click({ button: 'right' });
    await expect(menu, sel).toContainText('Copia riga e numero');
    await page.keyboard.press('Escape');
  }
});

test('la tessera delle partenze scrive il totale su cui sono calcolate le sue quote', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));
  await page.evaluate(() => {
    const iso = (gg) => new Date(Date.now() - gg * 24 * 3600 * 1000).toISOString();
    window.__mgTest.renderWorkerLog([
      { role: 'prober', startedAt: iso(1), num: '#1' },
      { role: 'verifier', startedAt: iso(2), num: '#2' },
    ]);
  });
  // Il numero grande conta i soli prober, la ripartizione tutti i ruoli: senza
  // il totale scritto, «1» in cima e «Verifica 1 · 50%» sotto sono la stessa
  // tessera letta in due modi.
  // Il «+» dice che il registro comincia dopo l'inizio della finestra: il
  // numero è un minimo, e resta un minimo anche nel totale.
  await expect(valore(page, 'routine')).toHaveText('1+');
  await expect(page.locator('.mg-st-card[data-card="routine"] .mg-st-card-sub')).toContainText('2+ in tutto');
});

test('il grafico degli arrivi non si deforma con la larghezza della finestra', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  const etichetta = () => page.evaluate(() => {
    const svg = document.getElementById('mgStBars');
    const t = svg && svg.querySelector('text.mg-st-bar-axis');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { larghezza: Math.round(r.width), testo: t.textContent };
  });

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(250);
  const largo = await etichetta();
  await page.setViewportSize({ width: 620, height: 900 });
  await page.waitForTimeout(300);
  const stretto = await etichetta();

  // Il disegno nasceva in un riquadro di misura fissa e veniva spalmato sulla
  // larghezza vera: la stessa data passava da 34 pixel a 14 e diventava una
  // macchia. Adesso il riquadro è in pixel veri e la scritta non cambia.
  expect(stretto, JSON.stringify({ largo, stretto })).not.toBeNull();
  expect(stretto.larghezza).toBeGreaterThan(largo.larghezza * 0.9);
  expect(stretto.larghezza).toBeLessThan(largo.larghezza * 1.1);
});

test('le fette e le barrette si raggiungono da tastiera, non solo col mouse', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  // La fetta prende il fuoco e Invio apre i lavori che ha contato.
  const fetta = page.locator('#mgStPie [data-group]').first();
  await fetta.focus();
  expect(await fetta.evaluate((el) => document.activeElement === el)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('#panel-fbstats .mg-st-drill')).toBeVisible();

  // La barretta prende il fuoco e Invio restringe la finestra a quel periodo:
  // era l'unica azione della scheda che si poteva fare solo col mouse.
  const barra = page.locator('#mgStBars rect.mg-st-bar').first();
  await barra.scrollIntoViewIfNeeded();
  await barra.focus();
  expect(await barra.evaluate((el) => document.activeElement === el)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('#mgStWindows .mg-st-chip--on')).toHaveAttribute('data-window', 'custom');
});

test('la torta non dice «nessuna lavorazione chiusa» se la tessera sopra ne conta una', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  // Una sola lavorazione chiusa, fermata alla verifica: giri da contare zero,
  // ma chiusa lo è. Le due frasi non possono smentirsi a vicenda.
  const ora = Date.now();
  await page.evaluate(({ n, c, u }) => window.__mgTest.setData([{
    _id: 'f1', seq: 1, subSeq: 0, clientId: 'u@e.com', text: 'ferma',
    status: 'done', createdAt: c, _updateTime: u, notes: n,
  }]), {
    n: BLOCCANTE,
    c: new Date(ora - 5 * 24 * 3600 * 1000).toISOString(),
    u: new Date(ora - 24 * 3600 * 1000).toISOString(),
  });
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  await expect(valore(page, 'lavorati')).toHaveText('1');
  const legenda = page.locator('#mgStPieLegend');
  await expect(legenda).not.toContainText('Nessuna lavorazione chiusa');
  await expect(legenda).toContainText('si è fermata alla verifica');
});

test('la scala dei colori della torta si scalda e non riusa una tinta', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  const ora = Date.now();
  // Lavorazioni costate 0, 1, 2, 3, 4, 5 e 7 critiche: sette fette.
  await page.evaluate(({ base }) => {
    // Ogni giro ha il SUO verbale e il SUO marcatore, come nelle conversazioni
    // vere: un verbale ripetuto identico sotto un marcatore ripetuto identico
    // non è un secondo giro, è qualcuno che cita il primo (#496, giro 12).
    const ora2 = (k) => String(8 + k).padStart(2, '0');
    const giro = (k) => [
      'Verifica: 1 rilievo.',
      `Provato: il giro ${k}.`,
      'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
      `- [1] Un rilievo, il numero ${k}`,
      '',
      `--- Aggiornamento dell'agente del 0${k}/09/2026, ${ora2(k)}:00 ---`,
      'Corretto.',
      '',
      `--- Aggiornamento dell'agente del 0${k}/09/2026, ${ora2(k)}:30 ---`,
      '',
    ].join('\n');
    const lista = [0, 1, 2, 3, 4, 5, 7].map((g, i) => ({
      _id: `c${i}`, seq: 300 + i, subSeq: 0, clientId: 'u@e.com', text: `lavoro ${i}`,
      status: 'done',
      createdAt: new Date(base - 5 * 24 * 3600 * 1000).toISOString(),
      _updateTime: new Date(base - 24 * 3600 * 1000).toISOString(),
      notes: `${Array.from({ length: g }, (_, k) => giro(k + 1)).join('')}--- Aggiornamento dell'agente del 09/09/2026, 18:00 ---\nVerifica superata.`,
    }));
    window.__mgTest.setData(lista);
  }, { base: ora });
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  const fette = await page.locator('#mgStPie [data-group]').evaluateAll((els) =>
    els.map((el) => ({ giri: Number(el.dataset.group), fill: el.getAttribute('fill') })));
  expect(fette.length).toBe(7);
  // Nessuna tinta ripetuta: due code diverse non possono diventare uno spicchio solo.
  expect(new Set(fette.map((f) => f.fill)).size).toBe(7);
  // E la scala si SCALDA: più critiche vuol dire meno verde, mai il contrario.
  // Prima finiva in viola e blu — i due colori più freddi — messi DOPO il
  // rosso, e la coda peggiore si leggeva come più tranquilla del centro.
  const quotaVerde = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return c[1] / (c[0] + c[1] + c[2]);
  };
  for (let i = 1; i < fette.length; i += 1) {
    expect(quotaVerde(fette[i].fill), `${fette[i].giri} critiche`)
      .toBeLessThan(quotaVerde(fette[i - 1].fill));
  }
});

test('tutte le tessere scrivono la quota accanto al numero, non solo due', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));
  for (const card of ['lavorati', 'adesso']) {
    await page.locator(`[data-card-toggle="${card}"]`).click();
  }
  const quote = await page.evaluate(() => Array.from(document.querySelectorAll('#mgStCards .mg-st-card'))
    .map((c) => ({
      id: c.dataset.card,
      righe: c.querySelectorAll('.mg-st-row').length,
      conQuota: Array.from(c.querySelectorAll('.mg-st-row-share')).filter((s) => s.textContent.trim()).length,
    })));
  for (const q of quote) expect(q.conQuota, `tessera ${q.id}`).toBe(q.righe);
});

// Una finestra scritta a mano lunga più di sei anni fa passare il grafico degli
// arrivi a una colonna per ANNO. L'etichetta però era quella del giorno, cioè
// «01/01» sotto ogni colonna: dodici date uguali, e l'asse non diceva più di
// che anno parlava. Ci si arriva sbagliando una cifra nell'anno d'inizio.
test('con una colonna per anno l’asse scrive l’anno, non «01/01» dodici volte', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  const oggi = new Date();
  const a = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, '0')}-${String(oggi.getDate()).padStart(2, '0')}`;
  await page.evaluate((fine) => window.__mgTest.setStatsWindow('custom', '2015-01-01', fine), a);

  const letto = await page.evaluate(() => ({
    nota: document.getElementById('mgStBarsNote').textContent.replace(/\s+/g, ' ').trim(),
    etichette: Array.from(document.querySelectorAll('#mgStBars .mg-st-bar-axis')).map((t) => t.textContent),
  }));
  expect(letto.nota, letto.nota).toContain('Una colonna per anno');
  expect(letto.etichette.length, letto.etichette.join(' ')).toBeGreaterThan(1);
  expect(new Set(letto.etichette).size, letto.etichette.join(' ')).toBe(letto.etichette.length);
  expect(letto.etichette[letto.etichette.length - 1]).toBe(String(oggi.getFullYear()));
});

// I due campi «dal» e «al» li disegna il browser nella lingua del sistema: su
// un computer non italiano scrivono mese/giorno, mentre tutte le altre date
// della scheda scrivono giorno/mese. Chi sceglie «01/09» credendo di prendere
// il primo settembre prende il nove gennaio, e i numeri cambiano senza che
// niente lo dica. Accanto ai campi la finestra vera, col mese a parole.
test('accanto ai campi data c’è la finestra scelta col mese a parole', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '2026-09-01', '2026-09-02'));
  const eco = page.locator('#mgStCustomEco');
  await expect(eco).toHaveText('dal 1 settembre 2026 al 2 settembre 2026');

  // Con una sola data l'eco dice fin dove arriva davvero.
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '2026-09-01', ''));
  await expect(eco).toHaveText('dal 1 settembre 2026 a oggi');

  // Con le date al contrario la finestra non vale, e i numeri sono quelli di
  // tutto lo storico: l'eco racconta QUELLO, non le due date scritte.
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '2026-09-05', '2026-09-01'));
  await expect(eco).toHaveText('tutto lo storico in pagina');

  // Su una finestra pronta i campi non ci sono, e nemmeno l'eco.
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));
  await expect(eco).toHaveText('');
});

// Le tre scorciatoie del filtro per creatore sono pastiglie come le altre nove,
// e portano la stessa domanda: quali sono queste segnalazioni? Senza una voce
// loro, il tasto destro ci apriva il menu generale della pagina, lo stesso che
// esce su uno spazio bianco.
test('anche «Tutti», «Persone» e «Routine» rispondono al tasto destro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));

  for (const sel of ['[data-creator-all]', '[data-creator-group="persone"]', '[data-creator-group="routine"]']) {
    await page.evaluate(() => document.querySelectorAll('.mg-ctxmenu').forEach((m) => m.remove()));
    const chip = page.locator(`#mgStCreators ${sel}`);
    const box = await chip.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    const voci = await page.evaluate(() => {
      const menu = document.querySelector('.mg-ctxmenu');
      return menu ? Array.from(menu.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent.trim()) : [];
    });
    expect(voci.join(' / '), sel).toMatch(/Mostra/);
    expect(voci.join(' / '), sel).toMatch(/Copia/);
  }

  // E la voce apre davvero le segnalazioni del gruppo.
  await page.evaluate(() => document.querySelectorAll('.mg-ctxmenu').forEach((m) => m.remove()));
  const routine = page.locator('#mgStCreators [data-creator-group="routine"]');
  const box = await routine.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.locator('.mg-ctxmenu [role="menuitem"]', { hasText: 'Mostra' }).first().click();
  await expect(page.locator('#panel-fbstats .mg-st-drill')).toHaveCount(1);
});

// La dashboard carica le 500 segnalazioni più recenti. Tre tessere contano
// DENTRO la finestra, quindi una finestra corta le rende esatte; «Aperte
// adesso» guarda invece tutta la lista in pagina, e quello che il tetto lascia
// fuori sono le segnalazioni più vecchie, cioè quelle rimaste in coda. Senza il
// «+» qui, tre tessere dicevano di essere minimi e la quarta, disegnata
// identica, si leggeva come un totale (#496, giro 14).
test('«Aperte adesso» porta il «+» quando il caricamento ha toccato il tetto', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriStatistiche(page);

  const ora = Date.now();
  const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();
  const lista = [];
  for (let i = 0; i < 500; i += 1) {
    const vecchia = i < 5;
    lista.push({
      _id: `t${i}`, seq: 2000 + i, subSeq: 0, clientId: 'tester@example.com',
      text: `segnalazione ${i}`, status: vecchia ? 'todo' : 'done',
      resolvedInVersion: vecchia ? undefined : '1.0.0',
      createdAt: iso(vecchia ? 300 + i : 1), _updateTime: iso(vecchia ? 300 + i : 1),
    });
  }
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
  // Finestra corta: i numeri della finestra sono esatti, «Aperte adesso» no.
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));

  const letto = await page.evaluate(() => ({
    adesso: document.querySelector('[data-card="adesso"] .mg-st-card-value').textContent.trim(),
    nota: document.getElementById('mgStNote').textContent.replace(/\s+/g, ' ').trim(),
  }));
  expect(letto.adesso, `${letto.adesso} | ${letto.nota}`).toContain('+');
  // E il «+» è spiegato: un segno senza didascalia non dice niente.
  expect(letto.nota, letto.nota).toContain('«Aperte adesso»');
});
