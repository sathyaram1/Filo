// Verifica #496 — giro 14. La citazione DATATA DOPO.
//
// Il giro 13 ha chiuso la citazione staccata da una riga vuota guardando
// l'ORDINE: i turni veri li appende Filo uno dopo l'altro, quindi il loro
// istante cresce sempre, e un marcatore più VECCHIO del turno prima è una
// copia. La difesa vale però solo quando la copia è più vecchia, si legge, ed
// è dello stesso tipo del turno prima.
//
// Chi risponde a una segnalazione ferma da giorni citando un pezzo di una
// segnalazione lavorata IERI incolla un marcatore più RECENTE dell'ultimo
// turno vero: l'ordine cresce, la difesa non morde, e la citazione torna a
// valere come un turno di Filo. Da lì, le stesse tre forme di danno di sempre:
// un giro in più, una lavorazione passata che si legge come fermata, e — nel
// verso opposto — i turni veri che vengono dopo la citazione inghiottiti.
//
// Sei porte, una causa sola. Quattro passano dalla SCRITTURA (si risponde
// dalla dashboard, si modifica la testa del campo note): quelle si provano
// facendo scrivere davvero, con le stesse funzioni che scrivono in produzione.
// Due si vedono anche su note già salvate, e si provano sul blob grezzo.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();
const AG = (t) => `--- Aggiornamento dell'agente del ${t} ---`;
const FILO = (t) => `--- Filo ha risposto il ${t} ---`;
const UT = (t) => `--- La tua risposta del ${t} ---`;

const FIX = 'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.';
const STOP = 'Il lavoro si ferma: c\'è un rilievo di livello 2 o 3 che non si può correggere da soli.';

function verbale(esito, livelli) {
  const n = livelli.length;
  return [
    `Verifica: ${n} ${n === 1 ? 'rilievo' : 'rilievi'}.`,
    'Provato: tutto quanto, e funziona.',
    esito,
    ...livelli.map((l, i) => `- [${l}] rilievo ${i + 1}`),
  ].join('\n');
}

const V = verbale(FIX, [2, 1]);
// Una lavorazione costata UN giro di correzione, poi passata. I turni veri
// sono datati all'inizio di settembre: la segnalazione è ferma da giorni.
const UN_GIRO = [
  `${AG('02/09/2026, 10:00')}\n${V}`,
  `${AG('03/09/2026, 10:00')}\nCorretto tutto.`,
  `${AG('04/09/2026, 10:00')}\nVerifica superata. Adesso funziona.`,
].join('\n\n');

function lavoro(notes) {
  return [{
    _id: 'p1', seq: 900, subSeq: 0, clientId: 'tester@example.com',
    name: 'una lavorazione', text: 'una lavorazione', status: 'done',
    createdAt: iso(9), _updateTime: iso(1), resolvedInVersion: '1.0.0', notes,
  }];
}

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
}

async function leggi(page, notes) {
  await page.evaluate((l) => window.__mgTest.setData(l), lavoro(notes));
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(150);
  return page.evaluate(() => ({
    legenda: Array.from(document.querySelectorAll('#mgStPieLegend li')).map((li) => li.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
    nota: document.getElementById('mgStPieNote').textContent.replace(/\s+/g, ' ').trim(),
  }));
}

// La risposta scritta dalla dashboard passa di qui, come in produzione.
function rispondi(page, notes, testo, ts) {
  return page.evaluate(([n, t, q]) => window.SN_FEEDBACK_THREAD.appendUserTurn(n, t, { ts: q }), [notes, testo, ts]);
}
// La testa del campo note, che si modifica a mano in una casella di testo.
function testaNote(page, testo, coda) {
  return page.evaluate(([t, c]) => {
    const head = window.SN_FEEDBACK_THREAD.composeNotes(t, []);
    return c ? `${head}\n\n${c}` : head;
  }, [testo, coda]);
}

test('la conversazione intatta si conta bene (riferimento)', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  const prima = await leggi(page, UN_GIRO);
  expect(prima.legenda, prima.legenda).toContain('1 critica');
  expect(prima.nota, prima.nota).toContain('1 giro di correzione');
});

// Porta 1: si risponde citando il verbale di un'ALTRA segnalazione, lavorata
// più tardi di questa. Il pezzo citato porta un marcatore più RECENTE
// dell'ultimo turno vero, quindi l'ordine cresce e la difesa del giro 13 non
// morde.
test('porta 1 — un verbale citato, datato dopo, non aggiunge un giro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  const testo = `Sull'altra segnalazione il verbale diceva:\n\n${AG('10/09/2026, 09:00')}\n${verbale(FIX, [1])}`;
  const p1 = await rispondi(page, UN_GIRO, testo, '11/09/2026, 11:00');
  const d1 = await leggi(page, p1);
  expect(d1.legenda, d1.legenda).toContain('1 critica');
  expect(d1.legenda, d1.legenda).not.toContain('2 critiche');
  expect(d1.nota, d1.nota).toContain('1 giro di correzione');
});

// Porta 2, la peggiore: lo stesso, quando il verbale citato è di un giro che
// aveva FERMATO il lavoro. Una lavorazione passata non deve leggersi come
// ferma in attesa di una decisione dell'owner.
test('porta 2 — un verbale citato che ferma non fa uscire la lavorazione dalla torta', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  const testo = `Sull'altra segnalazione il verbale diceva:\n\n${AG('10/09/2026, 09:00')}\n${verbale(STOP, [3])}`;
  const p2 = await rispondi(page, UN_GIRO, testo, '11/09/2026, 11:00');
  const d2 = await leggi(page, p2);
  const tutto = `${d2.legenda} / ${d2.nota}`;
  expect(tutto, tutto).not.toContain('si è fermata alla verifica');
  expect(d2.legenda, tutto).toContain('1 critica');
});

// Porta 3: un marcatore citato la cui data non si legge («ieri mattina»). Su un
// istante che non si legge il confronto sull'ordine non parte nemmeno, quindi
// qui la difesa è tutta nella scrittura.
test('porta 3 — un marcatore citato con la data illeggibile non apre un turno', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  const testo = `Riporto:\n\n${AG('ieri mattina')}\n${verbale(FIX, [1])}`;
  const p3 = await rispondi(page, UN_GIRO, testo, '11/09/2026, 11:00');
  const d3 = await leggi(page, p3);
  expect(d3.legenda, d3.legenda).toContain('1 critica');
  expect(d3.legenda, d3.legenda).not.toContain('2 critiche');
});

// Porta 4: l'altra forma della riga di separazione di Filo, citata e datata dopo.
test('porta 4 — l\'altra forma del marcatore, citata e datata dopo, non aggiunge un giro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  const testo = `Riporto:\n\n${FILO('10/09/2026, 09:00')}\n${verbale(FIX, [1])}`;
  const p4 = await rispondi(page, UN_GIRO, testo, '11/09/2026, 11:00');
  const d4 = await leggi(page, p4);
  expect(d4.legenda, d4.legenda).toContain('1 critica');
  expect(d4.legenda, d4.legenda).not.toContain('2 critiche');
});

// Porta 5, nel verso opposto: la citazione datata più avanti dei turni veri che
// la seguono se li porta via. Vale anche sulle note già salvate.
test('porta 5 — una citazione datata nel futuro non inghiotte i giri veri che seguono', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  const p5 = [
    `${AG('02/09/2026, 10:00')}\n${V}`,
    `${UT('02/09/2026, 11:00')}\nGuarda l'altra segnalazione:\n\n${AG('31/12/2027, 09:00')}\nUn turno qualunque.`,
    `${AG('03/09/2026, 10:00')}\n${verbale(FIX, [1])}`,
    `${AG('04/09/2026, 10:00')}\nVerifica superata. Adesso funziona.`,
  ].join('\n\n');
  const d5 = await leggi(page, p5);
  expect(d5.legenda, `${d5.legenda} / ${d5.nota}`).toContain('2 critiche');
});

// Porta 6: la testa del campo note, che dalla dashboard si modifica a mano in
// una casella di testo, con dentro un pezzo di conversazione incollato.
test('porta 6 — un verbale incollato in cima al campo note non inventa un giro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  const testa = `${AG('01/09/2026, 08:00')}\n${verbale(FIX, [1])}`;
  const coda = `${AG('04/09/2026, 10:00')}\nVerifica superata. Adesso funziona.`;
  const p6 = await testaNote(page, testa, coda);
  const d6 = await leggi(page, p6);
  const tutto = `${d6.legenda} / ${d6.nota}`;
  expect(d6.legenda, tutto).not.toContain('1 critica');
});

// Quello che si incolla resta leggibile: la riga citata non sparisce, diventa
// una citazione dichiarata.
test('la riga citata resta nel testo, marcata come citazione', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  const testo = `Riporto:\n\n${AG('10/09/2026, 09:00')}\nun turno qualunque.`;
  const notes = await rispondi(page, UN_GIRO, testo, '11/09/2026, 11:00');
  expect(notes, notes).toContain("> --- Aggiornamento dell'agente del 10/09/2026, 09:00 ---");
  expect(notes, notes).toContain('un turno qualunque.');
});
