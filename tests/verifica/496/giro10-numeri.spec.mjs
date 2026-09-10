// Verifica #496 — giro 10. Il grafico degli arrivi e le frasi che portano un
// numero: due punti dove la scheda dice meno del vero senza dichiararlo.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const iso = (g) => new Date(Date.now() - g * 24 * 3600 * 1000).toISOString();
const fra = (g) => new Date(Date.now() + g * 24 * 3600 * 1000).toISOString();

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
}

async function menuDopoTastoDestro(page, selettore) {
  await page.evaluate(() => {
    document.querySelectorAll('.mg-ctxmenu, .sn-select-pop, .sn-menu, [role="menu"]').forEach((m) => m.remove());
  });
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`manca ${sel}`);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
    }));
  }, selettore);
  await page.waitForTimeout(250);
  return page.evaluate(() => Array.from(document.querySelectorAll('[role="menu"], .mg-ctxmenu, .sn-select-pop'))
    .map((m) => m.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '));
}

test('una segnalazione con la data nel futuro non sparisce dal grafico in silenzio', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  // L'orologio storto sul computer di chi ha segnalato: la data è nel futuro.
  await page.evaluate((d) => {
    window.__mgTest.setData([
      { _id: 'f1', seq: 601, clientId: 'tester@example.com', text: 'oggi', status: 'todo', createdAt: d[0] },
      { _id: 'f2', seq: 602, clientId: 'tester@example.com', text: 'ieri', status: 'todo', createdAt: d[1] },
      { _id: 'f3', seq: 603, clientId: 'tester@example.com', text: 'futuro', status: 'todo', createdAt: d[2] },
    ]);
  }, [iso(0), iso(1), fra(30)]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(150);

  const stato = await page.evaluate(() => ({
    tessera: document.querySelector('[data-card-toggle="ricevuti"] .mg-st-card-value').textContent.trim(),
    colonne: Array.from(document.querySelectorAll('#mgStBars [data-bucket] title'))
      .map((t) => t.textContent).join(' | '),
    somma: Array.from(document.querySelectorAll('#mgStBars [data-bucket] title'))
      .reduce((a, t) => a + (Number((t.textContent.split(':')[1] || '').trim()) || 0), 0),
    nota: document.getElementById('mgStBarsNote').textContent,
  }));
  console.log('FUTURO:', JSON.stringify(stato, null, 1));
  // O le colonne contengono tutte le segnalazioni della tessera, o la riga
  // sotto il grafico dice quante ne lascia fuori (come fa per quelle senza
  // data d'arrivo leggibile).
  const dichiara = /non (?:ha|hanno) una data|nel futuro|fuori dal grafico|non (?:è|sono) nel grafico/i.test(stato.nota);
  expect(dichiara || stato.somma === Number(stato.tessera),
    `tessera ${stato.tessera}, colonne ${stato.somma}, nota «${stato.nota}»`).toBeTruthy();
});

test('la riga di avviso porta dei numeri, quindi il tasto destro risponde', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate((d) => {
    window.__mgTest.setData([
      { _id: 'g1', seq: 701, clientId: 'tester@example.com', text: 'x', status: 'todo', createdAt: d },
      { _id: 'g2', seq: 702, clientId: 'tester@example.com', text: 'y', status: 'todo', createdAt: 'non-una-data' },
    ]);
  }, iso(1));
  await page.evaluate(() => window.__mgTest.setStatsWindow('7d'));
  await page.waitForTimeout(150);

  const testo = await page.locator('#mgStNote').textContent();
  expect(testo, testo).toContain('non ha una data d’arrivo leggibile');
  const menu = await menuDopoTastoDestro(page, '#mgStNote');
  console.log('MENU riga di avviso:', JSON.stringify(menu));
  // Le altre due frasi della scheda (sotto la torta, sotto il grafico) si
  // copiano: questa porta un numero come loro.
  expect(menu, menu).not.toMatch(/Invia feedback|Invia attacco/);
});
