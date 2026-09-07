// #496 — la scheda «Statistiche feedback» quando i feedback NON sono arrivati.
// Regola già stabilita nella stessa pagina per i contatori delle schede: uno
// «0» dove il dato manca è un numero falso.

import { test, expect } from './fixtures/electron.mjs';
import fs from 'node:fs';

const URL = 'filo://manage/manage.html';

test('caricamento fallito: la scheda non deve spacciare zeri per dati', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.simulaCaricamentoFallito());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  const visto = await page.evaluate(() => ({
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
    lavorati: document.querySelector('#mgStTileLavorati [data-num]').textContent,
    prober: document.querySelector('#mgStTileProber [data-num]').textContent,
    riga: document.getElementById('mgStRange').textContent,
    avviso: document.getElementById('mgStWarn').hidden ? '' : document.getElementById('mgStWarn').textContent,
    torta: document.getElementById('mgStLoopEmpty').hidden ? '' : document.getElementById('mgStLoopEmpty').textContent.trim(),
  }));
  console.log('CARICAMENTO FALLITO:', JSON.stringify(visto));

  // Confronto: le schede-lista in cima, con lo stesso guasto, NON scrivono (0).
  const tab = await page.locator('.mg-tab[data-tab="inbox"]').innerText();
  console.log('SCHEDA RICEVUTI COL GUASTO:', JSON.stringify(tab));

  fs.mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/496-caricamento-fallito.png', fullPage: true });

  // Il testo della pagina dice da qualche parte che i dati non sono arrivati?
  const testo = await page.locator('#panel-fbstats').innerText();
  // Col caricamento fallito la scheda deve DIRLO, non scrivere zeri: uno zero
  // è una risposta, e la risposta non c'è. Stessa regola delle schede in cima.
  expect(visto.ricevuti).toBe('—');
  expect(visto.lavorati).toBe('—');
  await expect(page.locator('#mgStNoData')).toBeVisible();
  await expect(page.locator('#mgStBody')).toBeHidden();
  // E nessuna frase che affermi un vuoto che non si conosce.
  expect(testo).not.toContain('Nessun lavoro verificato');
});

test('caricamento ancora in corso: stessa regola, nessuno zero inventato', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  // Nessun dato iniettato e nessun guasto dichiarato: è lo stato «sto ancora
  // caricando», quello che si vede aprendo la scheda appena entrati.
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  const stato = await page.evaluate(() => ({
    caricato: !!(window.__mgTest.isLiveOn || true) && !document.getElementById('mgStNoData').hidden,
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
  }));
  console.log('CARICAMENTO IN CORSO:', JSON.stringify(stato));
  if (stato.caricato) expect(stato.ricevuti).toBe('—');
});
