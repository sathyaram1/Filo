// Verifica #496 — giro 7. La torta «Giri di verifica prima del pass»: il
// colore che deve dire se il numero è buono, e i conti che le arrivano dalla
// conversazione del feedback.
//
// Le porte qui dentro erano state trovate e chiuse nei giri passati: queste
// prove restano nel ramo perché il giro dopo le ritrovi già pronte.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const VERDE_DEL_PASS = 'rgb(59, 191, 122)';  // il colore di «passata subito»
const TRIM = '--- (i turni più vecchi sono stati rimossi: conversazione troppo lunga) ---';

const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();

// Un verbale come lo scrive il server: `n` critiche, poi il pass.
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

async function apri(page, lista) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
}

async function rimpiazza(page, lista) {
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
  await page.evaluate(() => window.__mgTest.renderStats());
}

const legenda = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('#mgStPieLegend li')).map((li) => ({
    testo: li.textContent,
    colore: getComputedStyle(li.querySelector('.mg-st-swatch')).backgroundColor,
  })));

test('la fetta più combattuta non prende il verde di «passata subito» quando è sola', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [lavoro('u1', 501, 5)]);
  const l = await legenda(page);
  expect(l).toHaveLength(1);
  expect(l[0].testo).toContain('5 critiche');
  expect(l[0].colore).not.toBe(VERDE_DEL_PASS);
});

test('il colore di una fetta non cambia a seconda di quali altre fette hanno dati', async ({ openTab }) => {
  const page = await openTab(URL);
  // Nessun lavoro passato al primo colpo: solo 2 e 5 critiche.
  await apri(page, [lavoro('a', 201, 2), lavoro('b', 202, 5)]);
  const sola = (await legenda(page)).find((x) => x.testo.includes('2 critiche'));
  expect(sola).toBeTruthy();
  expect(sola.colore).not.toBe(VERDE_DEL_PASS);

  // Ora la finestra comprende anche i pass immediati: la stessa fetta resta
  // dello stesso colore.
  await rimpiazza(page, [lavoro('a', 201, 2), lavoro('b', 202, 5), lavoro('c', 203, 0)]);
  const dopo = (await legenda(page)).find((x) => x.testo.includes('2 critiche'));
  expect(dopo.colore).toBe(sola.colore);
});

test('una conversazione tagliata dal tetto non fa sparire i giri in silenzio', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [lavoro('t1', 401, 5)]);
  await expect(page.locator('#mgStPieNote')).toContainText('Media: 5');

  // La stessa lavorazione, nella forma in cui è DAVVERO salvata quando la
  // conversazione supera il tetto: i turni vecchi non ci sono più e al loro
  // posto c'è la riga che dichiara il taglio.
  await rimpiazza(page, [lavoro('t2', 402, 5, { notes: `${TRIM}\n\nVerifica superata.` })]);

  const pieNote = await page.locator('#mgStPieNote').textContent();
  const nota = await page.locator('#mgStNote').textContent();
  const legenda2 = await page.locator('#mgStPieLegend').textContent();
  // Il lavoro più combattuto non può finire nella fetta verde senza che una
  // riga della scheda dica che dei giri mancano.
  const dichiara = /taglia|rimoss|troppo lunga|incomplet|manca/i.test(`${pieNote} ${nota} ${legenda2}`);
  expect(dichiara).toBe(true);
});

test('una frase scritta dentro un rilievo non cambia l’esito registrato del giro', async ({ openTab }) => {
  const page = await openTab(URL);
  const corpo = (rilievo) => [
    'Verifica: 1 rilievo.',
    'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
    `- [1] ${rilievo}`,
    '',
    '--- Aggiornamento dell\'agente del 01/09/2026, 10:00 ---',
    'Corretto.',
    '',
    'Verifica superata.',
  ].join('\n');

  await apri(page, [lavoro('s1', 511, 1, { notes: corpo('Manca l\'hover sull\'icona') })]);
  const sano = await page.locator('#mgStPieNote').textContent();
  expect(sano).toContain('1 giro di correzione');

  await rimpiazza(page, [lavoro('s1', 511, 1, {
    notes: corpo('Quando il registro non risponde il lavoro si ferma e la scheda non lo dice'),
  })]);
  const conFrase = await page.locator('#mgStPieNote').textContent();
  expect(conFrase).toBe(sano);
});
