// Verifica #496 — giro 7, seconda fotografia: le date che spariscono, le frasi
// dentro un rilievo, e cosa succede cliccando un numero.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();

async function apri(page, lista, finestra) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate((k) => window.__mgTest.setStatsWindow(k), finestra || '30d');
}

test('«Sempre»: le segnalazioni senza data escono dai conti senza una riga che lo dica', async ({ openTab }) => {
  const page = await openTab(URL);
  const b = (id, seq, over) => Object.assign({
    _id: id, seq, subSeq: 0, clientId: 'u@e.com', text: 't', status: 'todo',
  }, over);
  await apri(page, [
    b('d1', 301, { createdAt: iso(1) }),
    b('d2', 302, {}),                              // nessuna data
    b('d3', 303, { createdAt: 'non-una-data' }),   // data che non è una data
  ], 'all');

  const f = await page.evaluate(() => ({
    ricevuti: document.querySelector('.mg-st-card[data-card="ricevuti"] .mg-st-card-value').textContent,
    righe: Array.from(document.querySelectorAll('.mg-st-card[data-card="ricevuti"] .mg-st-row')).map((r) => r.textContent),
    nota: document.getElementById('mgStNote').textContent,
    barre: document.getElementById('mgStBarsNote').textContent,
  }));
  console.log('SEMPRE', JSON.stringify(f));
  // Tre in pagina: o il numero è 3, o la scheda dice quante ne ha lasciate fuori.
  const dichiara = /senza .*data|data d’arrivo|non ha una data|escluse|fuori/i.test(`${f.nota} ${f.barre}`);
  expect(f.ricevuti.trim() === '3' || dichiara).toBe(true);
});

test('una frase dentro un rilievo cambia l’esito registrato del giro', async ({ openTab }) => {
  const page = await openTab(URL);
  const base = {
    _id: 's', seq: 501, subSeq: 0, clientId: 'u@e.com', text: 't',
    status: 'done', createdAt: iso(9), _updateTime: iso(2),
  };
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

  await apri(page, [Object.assign({}, base, { notes: corpo('Manca l\'hover sull\'icona') })]);
  const sano = await page.locator('#mgStPieNote').textContent();

  await page.evaluate((n) => window.__mgTest.setData([Object.assign(
    { _id: 's', seq: 501, subSeq: 0, clientId: 'u@e.com', text: 't', status: 'done' },
    { createdAt: n.c, _updateTime: n.u, notes: n.notes },
  )]), {
    c: iso(9), u: iso(2),
    notes: corpo('Quando il registro non risponde il lavoro si ferma e la scheda non lo dice'),
  });
  await page.evaluate(() => window.__mgTest.renderStats());
  const conFrase = await page.locator('#mgStPieNote').textContent();

  console.log('SANO     ', JSON.stringify(sano));
  console.log('CON FRASE', JSON.stringify(conFrase));
  expect(conFrase).toBe(sano);
});

test('cliccare una riga della ripartizione non porta alle segnalazioni contate', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    { _id: 'q1', seq: 601, subSeq: 0, clientId: 'u@e.com', text: 'a', status: 'todo', createdAt: iso(1) },
    { _id: 'q2', seq: 602, subSeq: 0, clientId: 'u@e.com', text: 'b', status: 'attack', createdAt: iso(1) },
  ]);
  const riga = page.locator('.mg-st-card[data-card="ricevuti"] .mg-st-row').filter({ hasText: 'Attacchi' });
  await expect(riga).toHaveCount(1);
  const prima = await page.evaluate(() => document.body.innerHTML.length);
  const cursore = await riga.evaluate((el) => getComputedStyle(el).cursor);
  await riga.click();
  await page.waitForTimeout(250);
  await riga.click({ button: 'right' });
  await page.waitForTimeout(250);
  const dopo = await page.evaluate(() => ({
    lunghezza: document.body.innerHTML.length,
    listaAttiva: !!document.querySelector('#panel-list.mg-panel--active'),
    menu: Array.from(document.querySelectorAll('.mg-ctxmenu, .sn-select-pop'))
      .map((m) => m.textContent).join(' | '),
  }));
  console.log('DRILL', JSON.stringify({ cursore, prima, ...dopo }));
  const porta = dopo.listaAttiva || /contate|mostra|filtra|apri/i.test(dopo.menu);
  expect(porta).toBe(true);
});
