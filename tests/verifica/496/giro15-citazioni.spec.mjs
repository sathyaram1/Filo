// Verifica #496 — giro 15. La riga di separazione di tipo UTENTE, citata
// dentro il verbale di un giro di verifica.
//
// Il giro 14 ha chiuso la rincorsa alla scrittura: ogni riga che somigli a una
// separazione, mentre ENTRA nelle note dalla dashboard, diventa una citazione
// dichiarata («> …»). Restano le note già salvate — cioè tutte quelle che ci
// sono oggi — e per quelle la difesa è la lettura (`turnOpeners`), che promette
// di chiudere «le citazioni più vecchie del turno prima e quelle datate oltre i
// turni veri che le seguono».
//
// La promessa non vale per le righe di tipo UTENTE. I due tipi di marcatore si
// ordinano in due catene separate (i due orologi non si confrontano), e in una
// conversazione lavorata dalle sole routine la catena dell'utente è VUOTA:
// l'unica riga utente che c'è è quella citata, e una catena di uno non ha
// niente da cui risultare fuori posto. Quindi apre un turno: il verbale si
// spezza in due, il giro di correzione sparisce dalla torta, e la metà di sotto
// del verbale finisce in una bolla attribuita all'owner.
//
// Quattro porte, una causa sola: la citazione datata avanti, datata indietro,
// scritta «Riaperto il», e con un istante che non si legge.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();

const AG = (t) => `--- Aggiornamento dell'agente del ${t} ---`;
const UT = (t) => `--- La tua risposta del ${t} ---`;
const RIAP = (t) => `--- Riaperto il ${t} ---`;

const FIX = 'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.';

// Il verbale come lo scrive il server: intestazione, riassunto, riga d'esito,
// elenco dei rilievi.
function verbale(riassunto, livelli) {
  const n = livelli.length;
  return [
    `Verifica: ${n} ${n === 1 ? 'rilievo' : 'rilievi'}.`,
    riassunto,
    FIX,
    ...livelli.map((l, i) => `- [${l}] rilievo ${i + 1}`),
  ].join('\n');
}

const turni = (arr) => arr.map(([m, b]) => `${m}\n${b}`).join('\n\n');

// Riferimento: un giro di correzione, poi il pass. Nessuna citazione.
const SANO = turni([
  [AG('02/09/2026, 10:00'), verbale('Provato: funziona quasi tutto.', [1])],
  [AG('03/09/2026, 10:00'), 'Corretto.'],
  [AG('04/09/2026, 10:00'), 'Verifica superata.'],
]);

// Lo stesso lavoro, col riassunto che RIPORTA una riga di separazione.
function conCitazione(riga) {
  return turni([
    [AG('02/09/2026, 10:00'), verbale(['Provato. Il messaggio era questo:', '', riga, 'non va.'].join('\n'), [1])],
    [AG('03/09/2026, 10:00'), 'Corretto.'],
    [AG('04/09/2026, 10:00'), 'Verifica superata.'],
  ]);
}

const PORTE = [
  ['la citazione è datata DOPO i turni veri', conCitazione(UT('30/09/2026, 09:00'))],
  ['la citazione è datata PRIMA di tutto', conCitazione(UT('01/01/2020, 09:00'))],
  ['la citazione dice «Riaperto il»', conCitazione(RIAP('30/09/2026, 09:00'))],
  ['la citazione porta un istante che non si legge', conCitazione(UT('ieri mattina'))],
];

function lavoro(id, notes) {
  return {
    _id: id, seq: 900 + Number(String(id).replace(/\D/g, '') || 0), subSeq: 0,
    clientId: 'tester@example.com', name: `lavoro ${id}`, text: `lavoro ${id}`,
    status: 'done', createdAt: iso(9), _updateTime: iso(1),
    resolvedInVersion: '1.0.0', notes,
  };
}

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
}

async function scheda(page, notes) {
  await page.evaluate((l) => window.__mgTest.setData(l), [lavoro('1', notes)]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(150);
  return page.evaluate(() => ({
    legenda: Array.from(document.querySelectorAll('#mgStPieLegend li')).map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
    nota: (document.getElementById('mgStPieNote') || {}).textContent.replace(/\s+/g, ' ').trim(),
  }));
}

test('il riferimento: un giro di correzione si conta', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  const r = await scheda(page, SANO);
  console.log('SANO ' + JSON.stringify(r));
  expect(r.legenda.join(' ')).toContain('1 critica');
  expect(r.nota).toContain('Media: 1 giro prima del pass');
});

for (const [nome, notes] of PORTE) {
  test(`il giro non sparisce quando ${nome}`, async ({ openTab }) => {
    const page = await openTab(URL);
    await apri(page);
    const r = await scheda(page, notes);
    console.log(`${nome} → ${JSON.stringify(r)}`);
    // Il lavoro è costato un giro di correzione: la fetta è «1 critica», non
    // «Passata al primo giro».
    expect(r.legenda.join(' ')).toContain('1 critica');
    expect(r.legenda.join(' ')).not.toContain('Passata al primo giro');
    expect(r.nota).toContain('1 giro di correzione');
  });
}

test('la metà di sotto del verbale non diventa un messaggio dell’owner', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  const ruoli = await page.evaluate((n) => window.SN_FEEDBACK_THREAD.splitNotes(n)
    .map((s) => ({ role: s.role, ts: s.ts, inizio: s.body.slice(0, 40) })), conCitazione(UT('30/09/2026, 09:00')));
  console.log('TURNI ' + JSON.stringify(ruoli, null, 1));
  // Nessun turno dell'utente: in questa conversazione l'utente non ha scritto.
  expect(ruoli.filter((t) => t.role === 'user')).toEqual([]);
});
