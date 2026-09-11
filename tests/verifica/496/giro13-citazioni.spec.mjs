// Verifica #496 — giro 13. Una citazione staccata da una riga vuota.
//
// Il giro 12 ha chiuso la porta della riga di separazione CITATA DENTRO un
// capoverso: adesso quella riga apre un turno solo se è la prima del blob o se
// ha sopra una riga vuota. Ma un pezzo di conversazione, quando lo si incolla,
// lo si stacca da quello che si stava scrivendo — e allora la riga vuota c'è.
//
// Tre porte, una causa sola: due aggiungono un giro che non c'è stato (e una
// delle due fa leggere come «fermata all'owner» una lavorazione passata), una
// fa sparire il giro vero.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();
const AG = (t) => `--- Aggiornamento dell'agente del ${t} ---`;
const UT = (t) => `--- La tua risposta del ${t} ---`;

const FIX = 'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.';
const STOP = 'Il lavoro si ferma: la decisione passa all\'owner.';

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
// Una lavorazione costata UN giro di correzione, poi passata.
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

test('un pezzo di conversazione staccato da una riga vuota non inventa un giro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const prima = await leggi(page, UN_GIRO);
  expect(prima.legenda, prima.legenda).toContain('1 critica');

  // L'owner risponde citando un verbale di UN'ALTRA segnalazione, staccato dal
  // testo con una riga vuota, come si incolla un blocco.
  const citato = `${UN_GIRO}\n\n${UT('05/09/2026, 11:00')}\nNon mi torna. Su un'altra segnalazione il verbale diceva:\n\n${AG('01/08/2026, 09:00')}\n${verbale(FIX, [1])}`;
  const dopo = await leggi(page, citato);
  expect(dopo.legenda, dopo.legenda).toContain('1 critica');
  expect(dopo.legenda, dopo.legenda).not.toContain('2 critiche');
  expect(dopo.nota, dopo.nota).toContain('1 giro di correzione');
});

test('un verbale citato che ferma il lavoro non fa uscire dalla torta una lavorazione passata', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const citato = `${UN_GIRO}\n\n${UT('05/09/2026, 11:00')}\nMi ricorda questo:\n\n${AG('01/08/2026, 09:00')}\n${verbale(STOP, [2])}`;
  const dopo = await leggi(page, citato);
  expect(dopo.legenda, dopo.legenda).toContain('1 critica');
  expect(dopo.nota, dopo.nota).not.toContain('si è fermata alla verifica');
});

test('il verificatore che cita il verbale del giro prima non fa sparire il proprio giro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  // Nel riassunto il verificatore riporta il verbale a cui si riferisce,
  // staccato da una riga vuota: è come si cita un blocco.
  const conCitazione = [
    `${AG('02/09/2026, 10:00')}\n` + [
      'Verifica: 1 rilievo.',
      'Provato: tutto. Il giro prima diceva:',
      '',
      AG('01/09/2026, 08:00'),
      verbale(FIX, [2, 1, 0]),
      '',
      FIX,
      '- [1] resta solo questo',
    ].join('\n'),
    `${AG('03/09/2026, 10:00')}\nCorretto.`,
    `${AG('04/09/2026, 10:00')}\nVerifica superata.`,
  ].join('\n\n');

  const dopo = await leggi(page, conCitazione);
  expect(dopo.legenda, dopo.legenda).toContain('1 critica');
  expect(dopo.legenda, dopo.legenda).not.toContain('Passata al primo giro');
});
