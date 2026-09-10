// Verifica #496 — giro 8, dopo la correzione: com'è fatta adesso la scheda.
// Fotografia con dati realistici (torta a sette fette, elenco aperto sotto una
// riga di «Altre misure», grafico con poche colonne) in tema chiaro e scuro.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const OUT = 'tests/.shots';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();

function verbale(n) {
  const b = [];
  for (let i = 0; i < n; i += 1) {
    b.push(
      'Verifica: 1 rilievo.',
      'Provato: tutto quanto. Funziona.',
      'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
      '- [1] Un rilievo qualunque',
      '',
      `--- Aggiornamento dell'agente del 0${(i % 9) + 1}/09/2026, 10:00 ---`,
      'Corretto.',
      '',
    );
  }
  b.push('Verifica superata.');
  return b.join('\n');
}

function seed() {
  const lista = [];
  [0, 0, 0, 1, 1, 2, 3, 4, 5, 7].forEach((g, i) => lista.push({
    _id: `w${i}`, seq: 400 + i, subSeq: 0,
    clientId: i % 3 === 0 ? 'routine:prober' : 'tester@example.com',
    name: `lavorazione numero ${i}`, text: `lavorazione numero ${i}`,
    status: 'done', resolvedInVersion: '1.2.3',
    createdAt: iso(20 + i), _updateTime: iso(1 + (i % 6)), notes: verbale(g),
  }));
  ['todo', 'attack', 'spam', 'design', 'unlabeled', 'working', 'suspicious_file'].forEach((s, i) => lista.push({
    _id: `s${i}`, seq: 500 + i, subSeq: 0,
    clientId: ['utente@example.com', 'routine:prober', 'routine:worker', 'owner@example.com'][i % 4],
    name: `segnalazione ${s}`, text: `segnalazione ${s}`, status: s, createdAt: iso(i),
  }));
  return lista;
}

test.beforeAll(() => { try { mkdirSync(OUT, { recursive: true }); } catch (_) { /* c'è già */ } });

test('la scheda a correzione fatta: torta calda, righe che si aprono, grafico con la sua base', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => window.__mgTest.setData(l), seed());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  for (const id of ['lavorati', 'adesso']) {
    await page.locator(`[data-card-toggle="${id}"]`).click();
  }
  await page.waitForTimeout(150);

  // Sette fette, ognuna con un colore SUO: la coda non riusa il colore del
  // centro e non si confonde con la fetta accanto.
  const colori = await page.locator('#mgStPie [data-group]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('fill')));
  expect(colori.length).toBe(7);
  expect(new Set(colori).size).toBe(7);

  // Le percentuali ci sono in tutte le tessere che hanno una ripartizione.
  const quote = await page.evaluate(() => Array.from(document.querySelectorAll('#mgStCards .mg-st-card'))
    .map((c) => ({
      id: c.dataset.card,
      righe: Array.from(c.querySelectorAll('.mg-st-row')).length,
      conQuota: Array.from(c.querySelectorAll('.mg-st-row-share')).filter((s) => s.textContent.trim()).length,
    })));
  for (const q of quote) expect(q.conQuota, `tessera ${q.id}`).toBe(q.righe);

  await page.screenshot({ path: `${OUT}/496-giro8-dopo-chiaro.png`, fullPage: true });

  // L'elenco che si apre sotto una riga di «Altre misure».
  await page.locator('#mgStMore [data-drill="misura:bloccate"]').click();
  await expect(page.locator('#mgStMore .mg-st-drill')).toBeVisible();
  await page.screenshot({ path: `${OUT}/496-giro8-dopo-altre.png`, fullPage: true });

  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/496-giro8-dopo-scuro.png`, fullPage: true });
});

test('poche colonne: il grafico ha la sua linea di base e ogni colonna la sua data', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => window.__mgTest.setData([
    { _id: 'a', seq: 1, subSeq: 0, clientId: 'u@e.com', name: 'una', text: 'una', status: 'todo', createdAt: d[0] },
    { _id: 'b', seq: 2, subSeq: 0, clientId: 'u@e.com', name: 'due', text: 'due', status: 'todo', createdAt: d[1] },
  ]), [new Date(ora - 2 * 3600 * 1000).toISOString(), new Date(ora - 26 * 3600 * 1000).toISOString()]);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('24h'));
  await page.waitForTimeout(200);

  const g = await page.evaluate(() => ({
    barre: document.querySelectorAll('#mgStBars rect.mg-st-bar').length,
    base: document.querySelectorAll('#mgStBars line.mg-st-bar-base').length,
    etichette: Array.from(document.querySelectorAll('#mgStBars text')).map((t) => t.textContent),
  }));
  await page.screenshot({ path: `${OUT}/496-giro8-dopo-24h.png`, fullPage: true });
  expect(g.base).toBe(1);
  expect(g.barre).toBeGreaterThan(0);
  // Una data per ogni posto-colonna (anche quelli vuoti), non due etichette
  // agli estremi di un vuoto.
  expect(g.etichette.length).toBeGreaterThanOrEqual(g.barre);
  for (const e of g.etichette) expect(e).toMatch(/^\d{2}\/\d{2}$/);
});
