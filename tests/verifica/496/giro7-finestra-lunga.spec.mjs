// Verifica #496 — giro 7: la finestra scritta a mano molto lunga, e la
// finestra personalizzata lasciata a metà.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const OUT = 'tests/.shots';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();
const p = (n) => String(n).padStart(2, '0');
const giorno = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;

async function apri(page, lista) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
}

test.beforeAll(() => { try { mkdirSync(OUT, { recursive: true }); } catch (_) { /* c'è già */ } });

test('dal 1900 a oggi: il grafico degli arrivi resta vuoto e l’asse si ferma prima', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    { _id: 'g1', seq: 701, subSeq: 0, clientId: 'u@e.com', text: 'a', status: 'todo', createdAt: iso(1) },
    { _id: 'g2', seq: 702, subSeq: 0, clientId: 'u@e.com', text: 'b', status: 'todo', createdAt: iso(2) },
  ]);
  await page.evaluate((f) => window.__mgTest.setStatsWindow('custom', '1900-01-01', f), giorno(new Date(ora)));

  const f = await page.evaluate(() => ({
    ricevuti: document.querySelector('.mg-st-card[data-card="ricevuti"] .mg-st-card-value').textContent,
    barre: document.querySelectorAll('#mgStBars rect.mg-st-bar').length,
    asse: Array.from(document.querySelectorAll('#mgStBars text')).map((t) => t.textContent),
    nota: document.getElementById('mgStBarsNote').textContent,
  }));
  console.log('1900', JSON.stringify(f));
  await page.screenshot({ path: `${OUT}/496-giro7-finestra-1900.png`, fullPage: true });

  // Le due segnalazioni sono dentro la finestra (la tessera lo dice): il
  // grafico non può restare bianco e fermarsi a un anno in cui non c'è niente.
  expect(f.ricevuti.trim()).toBe('2');
  expect(f.barre).toBeGreaterThan(0);
});

test('«Dal… al…» con le caselle vuote: quello che si vede e quello che c’è scritto', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    { _id: 'v1', seq: 711, subSeq: 0, clientId: 'u@e.com', text: 'a', status: 'todo', createdAt: iso(400) },
    { _id: 'v2', seq: 712, subSeq: 0, clientId: 'u@e.com', text: 'b', status: 'todo', createdAt: iso(1) },
  ]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '', ''));
  const f = await page.evaluate(() => ({
    ricevuti: document.querySelector('.mg-st-card[data-card="ricevuti"] .mg-st-card-value').textContent,
    nota: document.getElementById('mgStNote').textContent,
  }));
  console.log('VUOTA', JSON.stringify(f));
  // O si mostra tutto e lo si chiama così, o non si mostra niente: non «non si
  // legge» accanto ai numeri di tutto lo storico.
  expect(/non si legge/i.test(f.nota) && f.ricevuti.trim() === '2').toBe(false);
});
