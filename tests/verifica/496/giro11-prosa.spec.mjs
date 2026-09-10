// Verifica #496 — giro 11. Le frasi con cui si racconta una verifica, ancora.
//
// I giri 4, 5, 7, 8, 9 e 10 hanno chiuso la stessa porta da sei lati. Il giro
// 10 ha cambiato àncora: adesso il verbale non si riconosce più da una frase,
// ma dalla sua STRUTTURA (la testata che dichiara quanti rilievi ci sono,
// l'elenco che ne ha esattamente quel numero). Qui si prova quello che una
// struttura, a differenza di una frase, si porta dietro: chi CITA un verbale
// ne cita anche la struttura, e il turno di chi corregge è il posto dove un
// verbale viene citato tutti i giorni.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();
const AG = (g) => `--- Aggiornamento dell'agente del 0${g}/09/2026, 10:00 ---`;

// Un verbale con dei rilievi, come lo scrive il server (roundNote).
function verbale(riassunto, livelli) {
  const n = livelli.length;
  const righe = [`Verifica: ${n} ${n === 1 ? 'rilievo' : 'rilievi'}.`];
  if (riassunto) righe.push(riassunto);
  righe.push('La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.');
  livelli.forEach((l, i) => righe.push(`- [${l}] rilievo ${i + 1}`));
  return righe.join('\n');
}

// Una lavorazione costata UN giro di correzione, poi passata.
function unGiro(reportCorrettore, livelli) {
  return [
    verbale('Provato: tutto quanto.', livelli || [2, 1]),
    `${AG(2)}\n${reportCorrettore}`,
    `${AG(3)}\nVerifica superata. Provato tutto: adesso funziona.`,
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
    legenda: Array.from(document.querySelectorAll('#mgStPieLegend li')).map((li) => li.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
    nota: document.getElementById('mgStPieNote').textContent.replace(/\s+/g, ' ').trim(),
  }));
}

test('chi corregge cita il verbale a cui risponde: il giro non si sdoppia', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const neutro = await leggi(page, unGiro('Corretto. Ho rilanciato le prove del giro.'));
  console.log('NEUTRO:', neutro.legenda, '||', neutro.nota);
  expect(neutro.legenda).toContain('1 critica');

  // Chi corregge riporta nel proprio report il verbale a cui sta rispondendo:
  // è il modo più naturale di dire «a questo sto rispondendo».
  const citato = await leggi(page, unGiro(
    `Fatto. Il verbale a cui rispondo era questo:\n${verbale('Provato: tutto quanto.', [2, 1])}\nTutti e due chiusi, prove rilanciate.`,
  ));
  console.log('CITATO:', citato.legenda, '||', citato.nota);
  expect(citato.legenda, citato.legenda).toContain('1 critica');
  expect(citato.legenda, citato.legenda).not.toContain('2 critiche');
});

test('chi corregge elenca i rilievi corretti: la lavorazione resta passata', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const neutro = await leggi(page, unGiro('Corretto tutto.'));
  console.log('NEUTRO:', neutro.legenda, '||', neutro.nota);
  expect(neutro.legenda).toContain('1 critica');

  // Il report di consegna che elenca cosa è stato corretto, col livello davanti
  // e col numero in cima: la forma in cui il verbale è arrivato a chi corregge.
  const elenco = await leggi(page, unGiro(
    'Verifica: 2 rilievi.\nHo corretto tutti e due.\n- [2] rilievo 1: chiuso.\n- [1] rilievo 2: chiuso.',
  ));
  console.log('ELENCO:', elenco.legenda, '||', elenco.nota);
  // Una lavorazione passata non può uscire dalla torta e finire fra quelle che
  // «si sono fermate alla verifica e le ha decise l'owner».
  expect(elenco.legenda, elenco.legenda).toContain('1 critica');
  expect(elenco.nota, elenco.nota).toContain('0 giri bloccanti');
});

test('la testata di un altro verbale citata nel riassunto non cancella il giro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const neutro = await leggi(page, unGiro('Corretto.'));
  expect(neutro.legenda).toContain('1 critica');

  // Il verificatore riporta a capo la riga con cui si apriva il verbale del
  // giro prima. Il numero non combacia con i rilievi di QUESTO giro, e il giro
  // sparisce del tutto invece di restare quello che è.
  const conCitazione = [
    verbale('Provato: tutto quanto. Il giro scorso si apriva così:\nVerifica: 3 rilievi.\ne quei tre li ho riprovati, sono chiusi.', [2, 1]),
    `${AG(2)}\nCorretto.`,
    `${AG(3)}\nVerifica superata. Adesso funziona.`,
  ].join('\n\n');
  const res = await leggi(page, conCitazione);
  console.log('CITAZIONE TESTATA:', res.legenda, '||', res.nota);
  expect(res.legenda, res.legenda).toContain('1 critica');
  expect(res.legenda, res.legenda).not.toContain('Passata al primo giro');
});

test('la frase vecchia coi due punti attaccati non inventa un giro bloccante', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const neutro = await leggi(page, unGiro('Corretto.'));
  expect(neutro.nota).toContain('0 giri bloccanti');

  const raccontato = await leggi(page, unGiro(
    'Controllo funzionalità NON superato: era il verdetto del giro scorso, adesso è chiuso.',
  ));
  console.log('DUE PUNTI:', raccontato.legenda, '||', raccontato.nota);
  expect(raccontato.legenda, raccontato.legenda).toContain('1 critica');
  expect(raccontato.nota, raccontato.nota).toContain('0 giri bloccanti');
});
