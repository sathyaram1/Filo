// Verifica #496 — giro 7, dopo la correzione: com'è fatta adesso la scheda.
// Fotografia della torta con più fette, dell'elenco che si apre sotto una riga
// e del grafico degli arrivi con poche colonne.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const OUT = 'tests/.shots';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();

function verbale(n) {
  let t = 0;
  const turno = () => `--- Aggiornamento dell'agente del 07/09/2026, ${++t} ---`;
  const b = [];
  for (let i = 0; i < n; i += 1) {
    // Ogni nota è un turno suo: è così che Filo appende il verbale e il report
    // di chi corregge.
    if (i) b.push(turno());
    b.push(
      'Verifica: 1 rilievo.',
      'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
      '- [1] Un rilievo qualunque',
      '',
      turno(),
      'Corretto.',
      '',
    );
  }
  if (n) b.push(turno());
  b.push('Verifica superata.');
  return b.join('\n');
}

test.beforeAll(() => { try { mkdirSync(OUT, { recursive: true }); } catch (_) { /* c'è già */ } });

test('la scheda a lavoro finito: torta a più fette, elenco aperto, grafico leggibile', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());

  const lista = [];
  const giri = [0, 0, 1, 1, 2, 3, 5];
  giri.forEach((g, i) => lista.push({
    _id: `w${i}`, seq: 700 + i, subSeq: 0, clientId: 'tester@example.com',
    text: `lavorazione numero ${i}`, status: 'done',
    createdAt: iso(10 + i), _updateTime: iso(1 + (i % 5)), notes: verbale(g),
  }));
  for (let i = 0; i < 5; i += 1) {
    lista.push({
      _id: `r${i}`, seq: 800 + i, subSeq: 0,
      clientId: i % 2 ? 'routine:prober' : 'utente@example.com',
      text: `segnalazione numero ${i}`, status: i === 1 ? 'attack' : 'todo',
      createdAt: iso(i),
    });
  }
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));

  // Cinque fette, ognuna col colore del suo numero di critiche.
  await expect(page.locator('#mgStPieLegend li')).toHaveCount(5);
  await page.screenshot({ path: `${OUT}/496-giro7-dopo-chiaro.png`, fullPage: true });

  // L'elenco che si apre sotto la riga, e da lì la segnalazione.
  await page.locator('[data-card-detail="ricevuti"] [data-drill="categoria:valida"]').click();
  await expect(page.locator('#panel-fbstats .mg-st-drill')).toBeVisible();
  await page.screenshot({ path: `${OUT}/496-giro7-dopo-elenco.png`, fullPage: true });

  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/496-giro7-dopo-scuro.png`, fullPage: true });

  // Le colonne del grafico non sono blocchi larghi mezzo schermo.
  const larghezza = await page.locator('#mgStBars rect.mg-st-bar').first()
    .evaluate((el) => Number(el.getAttribute('width')));
  expect(larghezza).toBeLessThanOrEqual(48);
});
