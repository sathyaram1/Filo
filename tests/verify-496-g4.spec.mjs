// #496 — l'altra faccia dello stesso blocco: la scheda aperta NON si accorge
// nemmeno quando i feedback SPARISCONO (caricamento andato male dopo).

import { test, expect } from './fixtures/electron.mjs';
import fs from 'node:fs';

const URL = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0, name: o.id, text: `x ${o.id}`,
  clientId: 'utente-esterno-1', createdAt: o.at, status: 'todo',
  notes: '', images: [], priority: 0,
});

test('il guasto arrivato a scheda aperta: i numeri restano lì senza dati sotto', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'a', seq: 1, at: iso(1) }), fb({ id: 'b', seq: 2, at: iso(1) }),
    fb({ id: 'c', seq: 3, at: iso(2) }),
  ]);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.waitForTimeout(300);
  const prima = await page.locator('#mgStTileRicevuti [data-num]').innerText();

  // Ora il caricamento va male (stessa cosa che fa il codice vero quando la
  // lista non arriva): i feedback non ci sono più.
  await page.evaluate(() => window.__mgTest.simulaCaricamentoFallito());
  await page.waitForTimeout(1200);
  const dopo = await page.evaluate(() => ({
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
    avviso: document.getElementById('mgStNoData').hidden ? '' : document.getElementById('mgStNoData').textContent.trim(),
    corpoNascosto: document.getElementById('mgStBody').hidden,
    schedaRicevuti: document.querySelector('.mg-tab[data-tab="inbox"]').textContent.trim(),
  }));
  console.log('PRIMA:', prima, '→ DOPO IL GUASTO:', JSON.stringify(dopo));
  fs.mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/496g4-guasto-dopo.png', fullPage: true });

  // Le schede in cima si accorgono del guasto (perdono il numero); la scheda
  // delle statistiche no: continua a mostrare i numeri di prima.
  expect(dopo.avviso, 'col guasto la scheda deve dirlo').not.toBe('');
});
