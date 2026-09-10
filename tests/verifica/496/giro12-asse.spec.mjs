// Verifica #496 — giro 12. L'asse del grafico degli arrivi quando le colonne
// sono anni.
//
// Il giro 7 aveva trovato una finestra scritta a mano lunghissima («dal 1900»)
// che lasciava il grafico bianco; la cura è stata una colonna per ANNO. Le
// etichette però sono rimaste quelle del giorno, quindi ogni colonna d'anno
// scrive la stessa data.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();

function dati() {
  return [0, 3, 5].map((g, i) => ({
    _id: 'f' + i, seq: 500 + i, subSeq: 0, clientId: 'tester@example.com',
    name: 'segnalazione ' + i, text: 'segnalazione ' + i, status: 'todo',
    createdAt: iso(g), _updateTime: iso(g),
  }));
}

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
}

test('con una colonna per anno le date sull’asse non sono tutte uguali', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate((l) => window.__mgTest.setData(l), dati());
  // Un anno d'inizio digitato con una cifra sbagliata: 2015 invece di 2025.
  const oggi = new Date();
  const iso10 = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, '0')}-${String(oggi.getDate()).padStart(2, '0')}`;
  await page.evaluate(([a, b]) => window.__mgTest.setStatsWindow('custom', a, b), ['2015-01-01', iso10]);
  await page.waitForTimeout(200);

  const letto = await page.evaluate(() => ({
    nota: document.getElementById('mgStBarsNote').textContent.replace(/\s+/g, ' ').trim(),
    etichette: Array.from(document.querySelectorAll('#mgStBars .mg-st-bar-axis')).map((t) => t.textContent),
  }));
  expect(letto.nota, letto.nota).toContain('anno');
  const uniche = new Set(letto.etichette);
  expect(uniche.size, `etichette: ${letto.etichette.join(' ')}`).toBe(letto.etichette.length);
});
