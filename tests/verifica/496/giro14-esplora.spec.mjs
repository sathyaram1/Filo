// Verifica #496 — giro 14. Esplorazione: la copertura del caricamento e
// l'aspetto nei due temi.
//
// La dashboard carica i 500 feedback più recenti. Tre tessere su quattro
// scrivono il numero col «+» quando quel tetto è stato toccato, e la riga in
// cima spiega che «i numeri con il + sono minimi, non totali». La quarta,
// «Aperte adesso», non conta nella finestra ma su TUTTA la lista in pagina:
// è la più esposta al tetto, ed è l'unica che il «+» non lo scrive mai.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const G = 24 * 3600 * 1000;
const iso = (g) => new Date(ora - g * G).toISOString();

// 500 = SN_FEEDBACK.LIST_PAGE_SIZE: il tetto del caricamento.
function tanti(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    // I più vecchi sono in coda: sono proprio quelli che il tetto lascia fuori.
    const vecchio = i < 5;
    out.push({
      _id: `f${i}`, seq: 1000 + i, subSeq: 0, clientId: 'tester@example.com',
      name: `segnalazione ${i}`, text: `segnalazione ${i}`,
      status: vecchio ? 'todo' : 'done',
      resolvedInVersion: vecchio ? undefined : '1.0.0',
      createdAt: iso(vecchio ? 300 + i : i % 20),
      _updateTime: iso(vecchio ? 300 + i : i % 20),
    });
  }
  return out;
}

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
}

async function tessere(page) {
  return page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#mgStCards .mg-st-card').forEach((c) => {
      const label = (c.querySelector('.mg-st-card-label') || {}).textContent || '';
      const value = (c.querySelector('.mg-st-card-value') || {}).textContent || '';
      out[label.replace(/\s+/g, ' ').trim()] = value.replace(/\s+/g, ' ').trim();
    });
    return { tessere: out, nota: (document.getElementById('mgStNote') || {}).textContent || '' };
  });
}

test('col caricamento al tetto, «Aperte adesso» dice di essere un minimo come le altre', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate((l) => window.__mgTest.setData(l), tanti(500));
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(200);

  const { tessere: t, nota } = await tessere(page);
  const dove = `${JSON.stringify(t)} | ${nota.replace(/\s+/g, ' ').trim()}`;
  // La riga in cima dichiara il tetto e promette il «+».
  expect(nota, dove).toContain('+');
  // Le tre tessere che il «+» lo scrivono.
  expect(t['Feedback ricevuti'], dove).toContain('+');
  // La quarta, che conta su tutta la lista in pagina e non sulla finestra.
  expect(t['Aperte adesso'], dove).toContain('+');
});

test('aspetto della scheda nei due temi, col caricamento al tetto', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate((l) => window.__mgTest.setData(l), tanti(120));
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(200);
  mkdirSync('tests/.shots', { recursive: true });
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, tema);
    await page.waitForTimeout(120);
    await page.screenshot({ path: `tests/.shots/496-giro14-${tema}.png`, fullPage: true });
  }
  // Nessuno scorrimento orizzontale a finestra stretta.
  await page.setViewportSize({ width: 620, height: 900 });
  await page.waitForTimeout(200);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `sborda di ${over}px`).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'tests/.shots/496-giro14-stretta.png', fullPage: true });
});
