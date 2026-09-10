// Verifica #496 — giro 8. Sonda: cosa risponde e cosa no sulle superfici della
// scheda, e come si vede una finestra corta.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const OUT = 'tests/.shots';
const ora = Date.now();
const iso = (h) => new Date(ora - h * 3600 * 1000).toISOString();

const lista = [
  { _id: 'a', seq: 1, subSeq: 0, clientId: 'u@e.com', name: 'una', text: 'una', status: 'todo', createdAt: iso(2) },
  { _id: 'b', seq: 2, subSeq: 0, clientId: 'u@e.com', name: 'due', text: 'due', status: 'attack', createdAt: iso(5) },
  { _id: 'c', seq: 3, subSeq: 0, clientId: 'routine:prober', name: 'tre', text: 'tre', status: 'done', createdAt: iso(20), _updateTime: iso(1), notes: 'Verifica superata.' },
  { _id: 'd', seq: 4, subSeq: 0, clientId: 'u@e.com', name: 'senza data', text: 'senza data', status: 'todo' },
];

test.beforeAll(() => { try { mkdirSync(OUT, { recursive: true }); } catch (_) { /* c'è già */ } });

test('sonda: superfici, finestra corta, segnalazioni senza data', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('24h'));
  await page.waitForTimeout(200);

  // Tasto destro sul numero grande di una tessera e su una pastiglia di filtro.
  await page.locator('.mg-st-card[data-card="ricevuti"] .mg-st-card-head').click({ button: 'right' });
  await page.waitForTimeout(200);
  const menuTessera = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.mg-ctxmenu, .sn-select-pop')).map((m) => m.textContent).join(' | '));
  await page.keyboard.press('Escape');

  await page.locator('#mgStWindows .mg-st-chip').first().click({ button: 'right' });
  await page.waitForTimeout(200);
  const menuChip = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.mg-ctxmenu, .sn-select-pop')).map((m) => m.textContent).join(' | '));
  await page.keyboard.press('Escape');

  const stato24h = await page.evaluate(() => ({
    ricevuti: document.querySelector('.mg-st-card[data-card="ricevuti"] .mg-st-card-value').textContent,
    nota: document.getElementById('mgStNote').textContent,
    barre: document.querySelectorAll('#mgStBars rect.mg-st-bar').length,
    larghezze: Array.from(document.querySelectorAll('#mgStBars rect.mg-st-bar')).map((r) => r.getAttribute('width')),
    barsNote: document.getElementById('mgStBarsNote').textContent,
  }));
  await page.screenshot({ path: `${OUT}/496-giro8-24h.png`, fullPage: true });

  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(150);
  const statoAll = await page.evaluate(() => ({
    ricevuti: document.querySelector('.mg-st-card[data-card="ricevuti"] .mg-st-card-value').textContent,
    nota: document.getElementById('mgStNote').textContent,
    barsNote: document.getElementById('mgStBarsNote').textContent,
  }));

  console.log(JSON.stringify({ menuTessera, menuChip, stato24h, statoAll }, null, 1));
  expect(true).toBe(true);
});
