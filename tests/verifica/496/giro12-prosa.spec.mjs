// Verifica #496 — giro 12. La riga che separa i turni è testo come tutto il
// resto, e chiunque la può scrivere.
//
// I giri dal 4 all'11 hanno chiuso, uno dopo l'altro, i modi in cui una frase o
// una struttura CITATA diventava un giro di verifica. L'àncora di adesso è
// doppia: il verbale deve esibire la sua struttura E stare da solo dentro un
// turno del programma. Quello che una citazione non doveva potersi portare
// dietro era il turno — ma un turno comincia da una RIGA DI TESTO nel blob
// delle note, e quella riga la può scrivere anche una persona che incolla un
// pezzo di conversazione, o un agente che la cita dentro il proprio verbale.
//
// Quattro porte, una causa sola. Due aggiungono un giro che non c'è stato, due
// fanno sparire un giro che c'è stato.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();
const AG = (g) => `--- Aggiornamento dell'agente del 0${g}/09/2026, 10:00 ---`;
const UT = (g) => `--- La tua risposta del 0${g}/09/2026, 11:00 ---`;

function verbale(riassunto, livelli) {
  const n = livelli.length;
  const righe = [`Verifica: ${n} ${n === 1 ? 'rilievo' : 'rilievi'}.`];
  if (riassunto) righe.push(riassunto);
  righe.push('La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.');
  livelli.forEach((l, i) => righe.push(`- [${l}] rilievo ${i + 1}`));
  return righe.join('\n');
}

const V = verbale('Provato: tutto quanto.', [2, 1]);
// Una lavorazione costata UN giro di correzione, poi passata.
const UN_GIRO = [V, `${AG(2)}\nCorretto.`, `${AG(3)}\nVerifica superata. Adesso funziona.`].join('\n\n');
// La stessa, ferma alla verifica: nessun pass registrato.
const FERMA = [V, `${AG(2)}\nCorretto.`].join('\n\n');

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

test('un pezzo di conversazione incollato in una risposta non aggiunge un giro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const prima = await leggi(page, UN_GIRO);
  expect(prima.legenda, prima.legenda).toContain('1 critica');

  // L'owner risponde citando il verbale a cui si riferisce, riga di
  // separazione compresa, e chiude il messaggio con la citazione.
  const conCitazione = `${UN_GIRO}\n\n${UT(4)}\nNon mi torna. Il giro diceva:\n\n${AG(2)}\n${V}`;
  const dopo = await leggi(page, conCitazione);
  expect(dopo.legenda, dopo.legenda).toContain('1 critica');
  expect(dopo.legenda, dopo.legenda).not.toContain('2 critiche');
  expect(dopo.nota, dopo.nota).toContain('1 giro di correzione');
});

test('un «Verifica superata.» incollato in una risposta non fa passare una lavorazione ferma', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const prima = await leggi(page, FERMA);
  expect(prima.nota, prima.nota).toContain('senza un pass registrato');

  // Una citazione riporta quello che c'è: la riga di separazione è quella del
  // turno citato, non una inventata.
  const conCitazione = `${FERMA}\n\n${UT(4)}\nRiporto quello che avevo letto:\n\n${AG(2)}\nVerifica superata.`;
  const dopo = await leggi(page, conCitazione);
  expect(dopo.nota, dopo.nota).toContain('senza un pass registrato');
  expect(dopo.legenda, dopo.legenda).not.toContain('1 critica');
});

test('il turno di chi corregge, quando è solo il verbale citato, non raddoppia il giro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const conCitazione = [V, `${AG(2)}\n${V}`, `${AG(3)}\nVerifica superata.`].join('\n\n');
  const dopo = await leggi(page, conCitazione);
  expect(dopo.legenda, dopo.legenda).toContain('1 critica');
  expect(dopo.legenda, dopo.legenda).not.toContain('2 critiche');
});

test('una riga di separazione citata dentro un verbale non fa sparire il giro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const prima = await leggi(page, UN_GIRO);
  expect(prima.legenda, prima.legenda).toContain('1 critica');

  // Il verificatore, nel riassunto, riporta la riga con cui la conversazione
  // separa i turni: è quello che si fa descrivendo cosa si è letto.
  for (const riga of [UT(3), AG(9)]) {
    const spezzato = [
      `${AG(1)}\n` + [
        'Verifica: 2 rilievi.',
        'Provato: tutto. Nella conversazione c’era questa riga:',
        riga,
        'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
        '- [2] rilievo 1',
        '- [1] rilievo 2',
      ].join('\n'),
      `${AG(2)}\nCorretto.`,
      `${AG(3)}\nVerifica superata.`,
    ].join('\n\n');
    const dopo = await leggi(page, spezzato);
    expect(dopo.legenda, `${riga} → ${dopo.legenda}`).toContain('1 critica');
    expect(dopo.legenda, `${riga} → ${dopo.legenda}`).not.toContain('Passata al primo giro');
  }
});
