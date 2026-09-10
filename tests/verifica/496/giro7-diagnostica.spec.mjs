// Verifica #496 — giro 7: la fotografia esatta di cosa scrive la scheda nei
// casi che i giri passati avevano chiuso. Serve a citare numeri veri nella
// critica; asserisce comunque, così non è solo un'esplorazione.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();

function conGiri(n) {
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
const lavoro = (id, seq, giri, over) => Object.assign({
  _id: id, seq, subSeq: 0, clientId: 'tester@example.com', text: 't',
  status: 'done', createdAt: iso(9), _updateTime: iso(2), notes: conGiri(giri),
}, over || {});

async function apri(page, lista, finestra) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate((k) => window.__mgTest.setStatsWindow(k), finestra || '30d');
}

const foto = (page) => page.evaluate(() => ({
  nota: (document.getElementById('mgStNote') || {}).textContent || '',
  pieNote: (document.getElementById('mgStPieNote') || {}).textContent || '',
  legenda: Array.from(document.querySelectorAll('#mgStPieLegend li')).map((li) => ({
    testo: li.textContent,
    colore: getComputedStyle(li.querySelector('.mg-st-swatch') || li).backgroundColor,
  })),
  ricevuti: (document.querySelector('.mg-st-card[data-card="ricevuti"] .mg-st-card-value') || {}).textContent || '',
  lavorati: (document.querySelector('.mg-st-card[data-card="lavorati"] .mg-st-card-value') || {}).textContent || '',
}));

test('conversazione tagliata dal tetto: la media crolla e nessuno lo dice', async ({ openTab }) => {
  const page = await openTab(URL);
  const TRIM = '--- (i turni più vecchi sono stati rimossi: conversazione troppo lunga) ---';
  await apri(page, [lavoro('t1', 401, 5)]);
  const intera = await foto(page);

  await page.evaluate((l) => window.__mgTest.setData(l), [
    lavoro('t2', 402, 5, { notes: `${TRIM}\n\nVerifica superata.` }),
  ]);
  await page.evaluate(() => window.__mgTest.renderStats());
  const tagliata = await foto(page);

  console.log('INTERA  ', JSON.stringify(intera.pieNote), JSON.stringify(intera.legenda.map((l) => l.testo)));
  console.log('TAGLIATA', JSON.stringify(tagliata.pieNote), JSON.stringify(tagliata.legenda.map((l) => l.testo)));
  console.log('NOTA    ', JSON.stringify(tagliata.nota));

  // Il lavoro più combattuto non può colorarsi come il migliore senza che
  // nessuna riga della scheda dica che dei giri mancano.
  const dichiara = /taglia|rimoss|troppo lunga|incomplet|manca/i.test(`${tagliata.pieNote} ${tagliata.nota}`);
  expect(dichiara).toBe(true);
});

test('la torta con una sola fetta la colora di verde qualunque cosa dica', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [lavoro('u1', 501, 5)]);
  const f = await foto(page);
  console.log('UNA FETTA', JSON.stringify(f.legenda));
  // Verde è il colore di «passata subito»: non può essere anche quello di
  // «5 critiche».
  expect(f.legenda[0].colore).not.toBe('rgb(59, 191, 122)');
});
