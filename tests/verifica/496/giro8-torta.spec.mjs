// Verifica #496 — giro 8. La torta dei giri prima del pass è il numero che la
// segnalazione chiedeva. Qui si prova che il TESTO scritto dal verificatore nel
// RIASSUNTO del verbale non cambia quel numero.
//
// I giri 5 e 7 avevano chiuso la stessa porta dal lato dei RILIEVI (le frasi
// dentro «- [1] …»). Il riassunto è l'altra metà della testa del verbale, ed è
// dove il verificatore racconta cosa succede: lì le stesse frasi mordono
// ancora.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();

// Un verbale come lo scrive il server: apertura, riassunto, frase d'esito,
// rilievi. Poi il turno di chi corregge, poi il pass.
function verbale(riassunto) {
  return [
    'Verifica: 1 rilievo.',
    riassunto,
    'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
    '- [1] Manca l’hover sull’icona',
    '',
    '--- Aggiornamento dell\'agente del 01/09/2026, 10:00 ---',
    'Corretto.',
    '',
    // Il pass è una nota a sé, quindi un turno a sé: è così che Filo la scrive.
    '--- Aggiornamento dell\'agente del 01/09/2026, 18:00 ---',
    'Verifica superata.',
  ].join('\n');
}

function lavoro(id, riassunto) {
  return {
    _id: id, seq: 900, subSeq: 0, clientId: 'tester@example.com',
    name: 'una lavorazione', text: 'una lavorazione', status: 'done',
    createdAt: iso(5), _updateTime: iso(1), notes: verbale(riassunto),
  };
}

async function leggi(page, lista) {
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(120);
  return page.evaluate(() => ({
    legenda: Array.from(document.querySelectorAll('#mgStPieLegend li')).map((li) => li.textContent),
    nota: document.getElementById('mgStPieNote').textContent,
  }));
}

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
}

test('una frase del riassunto non trasforma un giro di correzione in un giro bloccante', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const normale = await leggi(page, [lavoro('a1', 'Provato: tutto quanto. Funziona.')]);
  expect(normale.nota).toContain('1 giro di correzione');

  // La stessa identica lavorazione, col riassunto che descrive un difetto.
  const conFrase = await leggi(page, [lavoro('a1',
    'Provato: tutto quanto.\nIl lavoro si ferma quando il registro non risponde, e la scheda non lo dice.')]);
  expect(conFrase.nota).toContain('1 giro di correzione');
  expect(conFrase.nota).toContain('0 giri bloccanti');
});

test('una riga del riassunto che comincia come un verbale non fa sparire i giri', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const normale = await leggi(page, [lavoro('b1', 'Provato: tutto quanto. Funziona.')]);
  expect(normale.legenda.join(' ')).toContain('1 critica');

  // «Verifica: N rilievi …» scritto nel riassunto: è il modo naturale di
  // riassumere il giro prima.
  const aperturaFinta = await leggi(page, [lavoro('b1',
    'Provato: tutto quanto.\nVerifica: 2 rilievi del giro scorso sono chiusi.')]);
  expect(aperturaFinta.legenda.join(' ')).toContain('1 critica');
  expect(aperturaFinta.legenda.join(' ')).not.toContain('Passata subito');

  // E «Verifica superata.» scritto nel riassunto.
  const passFinto = await leggi(page, [lavoro('b1',
    'Provato: tutto quanto.\nVerifica superata. Le porte del giro scorso sono chiuse.')]);
  expect(passFinto.legenda.join(' ')).toContain('1 critica');
  expect(passFinto.legenda.join(' ')).not.toContain('Passata subito');
});
