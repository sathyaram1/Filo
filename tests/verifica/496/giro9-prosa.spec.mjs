// Verifica #496 — giro 9. Le frasi con cui si racconta una verifica non devono
// spostare i numeri della torta: è il numero che la segnalazione chiedeva.
//
// I giri 4, 5, 7 e 8 hanno chiuso la stessa porta da quattro lati diversi (il
// commento di una persona, il testo di un rilievo, il riassunto di un verbale).
// Qui si guarda dove il verbale NON è: il turno di chi corregge, e il riassunto
// di un verbale di PASS — le due parti della conversazione che il server scrive
// come turni a sé (SN_FEEDBACK_THREAD.appendModelTurn: una nota, un turno).

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();
const AG = (g) => `--- Aggiornamento dell'agente del 0${g}/09/2026, 10:00 ---`;

// Un verbale con dei rilievi, come lo scrive il server (roundNote): riga
// d'apertura, riassunto, riga d'esito, elenco dei rilievi.
function verbale(riassunto, n) {
  const righe = [`Verifica: ${n} ${n === 1 ? 'rilievo' : 'rilievi'}.`];
  if (riassunto) righe.push(riassunto);
  righe.push('La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.');
  for (let i = 0; i < n; i += 1) righe.push(`- [1] rilievo ${i + 1}`);
  return righe.join('\n');
}

// Ogni nota del server è un TURNO suo: verbale, correzione, verbale, correzione,
// pass. Due giri prima del pass, sempre.
function dueGiri(reportCorrettore) {
  return [
    verbale('Provato: tutto quanto.', 2),
    `${AG(2)}\n${reportCorrettore}`,
    `${AG(3)}\n${verbale('Provato: le porte del giro scorso sono chiuse.', 1)}`,
    `${AG(4)}\n${reportCorrettore}`,
    `${AG(5)}\nVerifica superata. Provato tutto: adesso funziona.`,
  ].join('\n\n');
}

// Un giro solo prima del pass, e il pass racconta com'era andata prima.
function unGiro(riassuntoDelPass) {
  return [
    verbale('Provato: tutto quanto.', 1),
    `${AG(2)}\nCorretto.`,
    `${AG(3)}\nVerifica superata. ${riassuntoDelPass}`,
  ].join('\n\n');
}

function lavoro(notes) {
  return [{
    _id: 'p1', seq: 900, subSeq: 0, clientId: 'tester@example.com',
    name: 'una lavorazione', text: 'una lavorazione', status: 'done',
    createdAt: iso(9), _updateTime: iso(1), notes,
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
  await page.waitForTimeout(120);
  return page.evaluate(() => ({
    legenda: Array.from(document.querySelectorAll('#mgStPieLegend li')).map((li) => li.textContent).join(' | '),
    nota: document.getElementById('mgStPieNote').textContent,
  }));
}

test('il report di chi corregge non aggiunge un giro passato che non c’è', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const neutro = await leggi(page, dueGiri('Corretto. Ho rilanciato le prove del giro.'));
  expect(neutro.legenda).toContain('2 critiche');

  // Chi corregge racconta di aver rilanciato le prove: è italiano normale, e la
  // sua nota è un turno a sé, non la coda del verbale.
  const raccontato = await leggi(page, dueGiri('Ho rilanciato le prove del giro.\n\nVerifica superata. Nessuna regressione.'));
  expect(raccontato.legenda, raccontato.legenda).toContain('2 critiche');
  expect(raccontato.legenda).not.toContain('1 critica');
});

test('il report di chi corregge non inventa un giro bloccante', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const neutro = await leggi(page, unGiro('Provato tutto: adesso funziona.'));
  expect(neutro.nota).toContain('0 giri bloccanti');

  const raccontato = await leggi(page, [
    verbale('Provato: tutto quanto.', 1),
    `${AG(2)}\nHo corretto.\n\nControllo funzionalità NON superato era il verdetto del giro scorso.`,
    `${AG(3)}\nVerifica superata. Provato tutto.`,
  ].join('\n\n'));
  expect(raccontato.nota, raccontato.nota).toContain('0 giri bloccanti');
  expect(raccontato.legenda, raccontato.legenda).toContain('1 critica');
});

test('il riassunto di un verbale superato non ribalta l’esito della lavorazione', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const neutro = await leggi(page, unGiro('Provato tutto: adesso funziona.'));
  expect(neutro.legenda).toContain('1 critica');

  // Il verificatore racconta il giro prima dentro il riassunto del suo pass.
  for (const riga of [
    'Controllo funzionalità NON superato nel giro scorso, adesso sì.',
    'Verifica: funziona, ma migliorabile — così diceva il giro scorso.',
  ]) {
    const res = await leggi(page, unGiro(`Provato tutto.\n\n${riga}`));
    expect(res.legenda, `${riga} → ${res.legenda}`).toContain('1 critica');
    expect(res.nota, `${riga} → ${res.nota}`).toContain('0 giri bloccanti');
  }
});
