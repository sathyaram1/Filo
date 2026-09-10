// Verifica #496 — giro 7. I numeri della scheda: quello che contano, quello
// che dichiarano di non poter contare, e dove portano quando ci si clicca.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();
const seg = (id, seq, over) => Object.assign({
  _id: id, seq, subSeq: 0, clientId: 'u@e.com', text: 't', status: 'todo',
}, over || {});

async function apri(page, lista, finestra) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate((k) => window.__mgTest.setStatsWindow(k), finestra || '30d');
}

test('«Sempre» conta anche le segnalazioni senza una data d’arrivo, o dichiara quante ne lascia fuori', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    seg('d1', 301, { createdAt: iso(1) }),
    seg('d2', 302, {}),                             // nessuna data
    seg('d3', 303, { createdAt: 'non-una-data' }),  // una data che non è una data
  ], 'all');

  const f = await page.evaluate(() => ({
    ricevuti: document.querySelector('.mg-st-card[data-card="ricevuti"] .mg-st-card-value').textContent,
    nota: document.getElementById('mgStNote').textContent,
    barre: document.getElementById('mgStBarsNote').textContent,
  }));
  const dichiara = /senza .*data|data d’arrivo|non ha una data|escluse|fuori da/i.test(`${f.nota} ${f.barre}`);
  expect(f.ricevuti.trim() === '3' || dichiara).toBe(true);
});

test('«Prober lanciati» non scrive un numero quando quel numero non si conosce', async ({ openTab }) => {
  const page = await openTab(URL);
  // Nel contenitore la sessione non è quella dell'owner: il registro delle
  // partenze è riservato, quindi quel numero non si può sapere.
  await apri(page, [seg('p1', 801, { createdAt: iso(1) })]);
  const f = await page.evaluate(() => ({
    routine: document.querySelector('.mg-st-card[data-card="routine"] .mg-st-card-value').textContent,
    sotto: document.querySelector('.mg-st-card[data-card="routine"] .mg-st-card-sub').textContent,
    nota: document.getElementById('mgStNote').textContent,
  }));
  expect(/riservato/i.test(f.nota)).toBe(true);
  // Le tessere accanto, davanti a un dato che manca, scrivono un trattino.
  expect(f.routine.trim()).not.toBe('0');
});

test('da un numero si arriva alle segnalazioni che ha contato', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    seg('q1', 601, { createdAt: iso(1) }),
    seg('q2', 602, { createdAt: iso(1), status: 'attack' }),
  ]);
  const riga = page.locator('.mg-st-card[data-card="ricevuti"] .mg-st-row').filter({ hasText: 'Attacchi' });
  await expect(riga).toHaveCount(1);

  await riga.click();
  await page.waitForTimeout(250);
  await riga.click({ button: 'right' });
  await page.waitForTimeout(250);

  const dopo = await page.evaluate(() => ({
    elenco: !!document.querySelector('#panel-fbstats .mg-st-drill, #panel-fbstats [data-elenco]'),
    listaAttiva: !!document.querySelector('#panel-list.mg-panel--active'),
    menu: Array.from(document.querySelectorAll('.mg-ctxmenu, .sn-select-pop'))
      .map((m) => m.textContent).join(' | '),
  }));
  const porta = dopo.elenco || dopo.listaAttiva || /contate|mostra|filtra|apri/i.test(dopo.menu);
  expect(porta).toBe(true);
});

test('dal 1900 a oggi: le segnalazioni contate si vedono anche nel grafico degli arrivi', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    seg('g1', 701, { createdAt: iso(1) }),
    seg('g2', 702, { createdAt: iso(2) }),
  ]);
  const d = new Date(ora);
  const p = (n) => String(n).padStart(2, '0');
  await page.evaluate((f) => window.__mgTest.setStatsWindow('custom', '1900-01-01', f),
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);

  const f = await page.evaluate(() => ({
    ricevuti: document.querySelector('.mg-st-card[data-card="ricevuti"] .mg-st-card-value').textContent,
    barre: document.querySelectorAll('#mgStBars rect.mg-st-bar').length,
    asse: Array.from(document.querySelectorAll('#mgStBars text')).map((t) => t.textContent),
    nota: document.getElementById('mgStBarsNote').textContent,
  }));
  // La tessera dice 2: il grafico non può restare bianco su un asse che si
  // ferma a un anno in cui non è successo niente.
  expect(f.ricevuti.trim()).toBe('2');
  expect(f.barre).toBeGreaterThan(0);
});
