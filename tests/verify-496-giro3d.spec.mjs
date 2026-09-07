// #496 giro 3 — tenuta visiva sul tema scuro (data-sn-theme) e finestra
// personalizzata: l'eco della data a parole, i due campi, il vuoto.

import { test, expect } from './fixtures/electron.mjs';
import fs from 'node:fs';

const URL = 'filo://manage/manage.html';
const OUT = 'tests/.shots';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const PASS = 'Verifica superata. Provato tutto.';
const TURNO = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";
const CRIT = (n) => Array.from({ length: n }, () => `${TURNO}Verifica: 1 rilievo. Il verificatore corregge.`).join('');

const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0, name: o.id, text: `Segnalazione ${o.id}`,
  clientId: o.clientId || 'utente-esterno-1', createdAt: o.at,
  status: o.status || 'todo', notes: o.notes || '', images: [], priority: o.priority || 0,
  _updateTime: 't1',
});
const DATI = [
  fb({ id: 'a', seq: 1, at: iso(1), status: 'done', clientId: 'routine:prober', notes: `R.${TURNO}${PASS}` }),
  fb({ id: 'b', seq: 2, at: iso(2), status: 'done', notes: `R.${CRIT(2)}${TURNO}${PASS}` }),
  fb({ id: 'c', seq: 3, at: iso(3), status: 'working', priority: 3 }),
  fb({ id: 'd', seq: 4, at: iso(6), priority: 2 }),
];

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => window.__mgTest.setData(d), DATI);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
}

test('tema scuro: la scheda e i due campi data', async ({ openTab }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/496g3-scuro-vero.png`, fullPage: true });

  await page.locator('.mg-st-chip[data-window="custom"]').click();
  await page.locator('#mgStFrom').fill('2026-09-01');
  await page.locator('#mgStFrom').dispatchEvent('change');
  await page.locator('#mgStTo').fill('2026-09-05');
  await page.locator('#mgStTo').dispatchEvent('change');
  await page.waitForTimeout(300);
  const eco = await page.locator('#mgStDateEcho').textContent();
  console.log('ECO DELLE DATE →', JSON.stringify(eco));
  console.log('RIGA →', JSON.stringify(await page.locator('#mgStRange').textContent()));
  await page.screenshot({ path: `${OUT}/496g3-scuro-date.png`, fullPage: true });
  expect(eco).toContain('settembre');
});

test('finestra personalizzata: date vuote, una sola, invertite', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  const leggi = async () => ({
    warn: await page.locator('#mgStWarn').isVisible() ? (await page.locator('#mgStWarn').textContent()).trim() : null,
    riga: (await page.locator('#mgStRange').textContent()).trim(),
    eco: (await page.locator('#mgStDateEcho').textContent()).trim(),
    ricevuti: await page.locator('#mgStTileRicevuti [data-num]').textContent(),
  });
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '', ''));
  console.log('VUOTE →', JSON.stringify(await leggi(), null, 1));
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '2026-09-01', ''));
  console.log('SOLO DA →', JSON.stringify(await leggi(), null, 1));
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '2026-09-05', '2026-09-01'));
  console.log('INVERTITE →', JSON.stringify(await leggi(), null, 1));
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', 'non-una-data', '9999-99-99'));
  console.log('SPAZZATURA →', JSON.stringify(await leggi(), null, 1));
  const testo = await page.locator('#panel-fbstats').innerText();
  expect(testo).not.toMatch(/undefined|NaN|Invalid/);
});
