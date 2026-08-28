// VERIFICA #495 — la colonna durante la ricerca.
import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = 'filo://manage/manage.html';
const SHOTS = join(process.cwd(), 'tests', '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

test('ricerca — la lista dei risultati e la sua intestazione', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setData([
    { _id: 'a', status: 'unlabeled', text: 'la stampante non stampa', name: 'Stampante', seq: 1, subSeq: 0, createdAt: '2026-01-01T00:00:00Z', images: [] },
    { _id: 'b', status: 'todo', text: 'stampa in PDF rotta', name: 'Stampa PDF', seq: 2, subSeq: 0, createdAt: '2026-01-01T00:00:00Z', images: [] },
    { _id: 'c', status: 'todo', text: 'il tema scuro è illeggibile', name: 'Tema', seq: 3, subSeq: 0, createdAt: '2026-01-01T00:00:00Z', images: [] },
  ]));

  const headBefore = (await page.locator('#mgListHead').textContent()).trim();
  expect(headBefore).toBe('RICEVUTI (1)'.replace('RICEVUTI', 'Ricevuti')); // il CSS lo rende maiuscolo

  await page.locator('.mg-search-toggle').click();
  await page.locator('#mgSearchInput').fill('stampa');
  await page.locator('#mgSearchInput').press('Enter');
  await page.waitForTimeout(3000);

  const n = await page.locator('#mgList .mg-item').count();
  const head = (await page.locator('#mgListHead').textContent()).trim();
  const msg = await page.locator('#mgSearchMsg').textContent().catch(() => '');
  console.log(`RICERCA → risultati=${n} intestazione="${head}" messaggio="${msg}"`);
  await page.screenshot({ path: join(SHOTS, 'v495-ricerca.png') });

  // Chiudendo la ricerca il numero della scheda torna.
  await page.locator('.mg-search-toggle').click();
  await expect(page.locator('#mgListHead')).toHaveText('Ricevuti (1)');
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (1)');
});
