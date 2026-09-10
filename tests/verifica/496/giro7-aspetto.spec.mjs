// Verifica #496 — giro 7: com'è fatta la scheda a vedersi. Stato vuoto, tema
// scuro, finestra stretta, e il numero delle partenze quando non si conosce.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const OUT = 'tests/.shots';
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

test.beforeAll(() => { try { mkdirSync(OUT, { recursive: true }); } catch (_) { /* c'è già */ } });

test('stato vuoto e finestra stretta: niente rettangoli vuoti né scorrimento orizzontale', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [], 'all');
  await page.setViewportSize({ width: 620, height: 900 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/496-giro7-vuoto-stretto.png`, fullPage: true });
  const orizzontale = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(orizzontale).toBe(false);
});

test('tema scuro: la scheda si legge', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    { _id: 'k1', seq: 901, subSeq: 0, clientId: 'u@e.com', text: 'a', status: 'todo', createdAt: iso(1) },
    { _id: 'k2', seq: 902, subSeq: 0, clientId: 'routine:prober', text: 'b', status: 'done', createdAt: iso(4), _updateTime: iso(1), notes: 'Verifica superata.' },
  ], 'all');
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/496-giro7-scuro.png`, fullPage: true });
  await expect(page.locator('#panel-fbstats')).toBeVisible();
});
