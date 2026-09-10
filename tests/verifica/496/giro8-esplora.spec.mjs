// Verifica #496 — giro 8. Esplorazione: la scheda con dati realistici, i
// numeri che si aprono (e quelli che non si aprono), il tasto destro dove c'è
// e dove manca, i colori della torta, e le due schermate (chiaro e scuro).

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const OUT = 'tests/.shots';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();

// Il verbale come lo scrive davvero il server (SN_VERIFIER_ROUND.roundNote):
// n giri con rilievi, poi il pass.
function verbale(n, { esito = 'fix' } = {}) {
  const b = [];
  for (let i = 0; i < n; i += 1) {
    b.push(
      'Verifica: 1 rilievo.',
      'Provato: tutto quanto. Funziona.',
      esito === 'stop'
        ? 'Il lavoro si ferma: c\'è un rilievo di livello 2 o 3 che non si può correggere da soli (bilancio esaurito, o chiede una tua decisione).'
        : 'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
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
  // Lavorazioni chiuse con giri diversi: 0,0,0,1,1,2,3,4,5,7
  [0, 0, 0, 1, 1, 2, 3, 4, 5, 7].forEach((g, i) => lista.push({
    _id: `w${i}`, seq: 400 + i, subSeq: 0,
    clientId: i % 3 === 0 ? 'routine:prober' : 'tester@example.com',
    name: `lavorazione numero ${i}`, text: `lavorazione numero ${i}`,
    status: 'done', resolvedInVersion: '1.2.3',
    createdAt: iso(20 + i), _updateTime: iso(1 + (i % 6)), notes: verbale(g),
  }));
  // Segnalazioni di categorie diverse, mittenti diversi.
  const stati = ['todo', 'attack', 'spam', 'design', 'unlabeled', 'working', 'suspicious_file'];
  stati.forEach((s, i) => lista.push({
    _id: `s${i}`, seq: 500 + i, subSeq: 0,
    clientId: ['utente@example.com', 'routine:prober', 'routine:worker', 'owner@example.com'][i % 4],
    name: `segnalazione ${s}`, text: `segnalazione ${s}`, status: s,
    priority: (i % 3) + 1, createdAt: iso(i),
  }));
  return lista;
}

async function apri(page, lista, finestra) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate((k) => window.__mgTest.setStatsWindow(k), finestra || '30d');
  await page.waitForTimeout(150);
}

test.beforeAll(() => { try { mkdirSync(OUT, { recursive: true }); } catch (_) { /* c'è già */ } });

test('esplorazione: la scheda con dati realistici', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, seed(), 'all');

  // Apri tutte le tessere, così la fotografia mostra le ripartizioni.
  for (const id of ['lavorati', 'routine', 'adesso']) {
    await page.locator(`[data-card-toggle="${id}"]`).click();
    await page.waitForTimeout(60);
  }
  await page.screenshot({ path: `${OUT}/496-giro8-chiaro.png`, fullPage: true });

  const dump = await page.evaluate(() => {
    const q = (s) => Array.from(document.querySelectorAll(s));
    return {
      nota: document.getElementById('mgStNote').textContent,
      tessere: q('#mgStCards .mg-st-card').map((c) => ({
        id: c.dataset.card,
        v: c.querySelector('.mg-st-card-value').textContent,
        l: c.querySelector('.mg-st-card-label').textContent,
        sub: (c.querySelector('.mg-st-card-sub') || {}).textContent || '',
        righe: Array.from(c.querySelectorAll('.mg-st-row')).map((r) => ({
          t: r.textContent, apre: r.tagName === 'BUTTON',
        })),
      })),
      legenda: q('#mgStPieLegend li').map((li) => ({
        t: li.textContent,
        col: (li.querySelector('.mg-st-swatch') || {}).style?.background || '',
      })),
      fette: q('#mgStPie [data-group]').map((p) => ({ g: p.dataset.group, fill: p.getAttribute('fill') })),
      pieNote: document.getElementById('mgStPieNote').textContent,
      barsNote: document.getElementById('mgStBarsNote').textContent,
      altre: q('#mgStMore li').map((li) => ({ t: li.textContent, tag: li.tagName, drill: !!li.querySelector('[data-drill]') })),
      titoli: q('#panel-fbstats .mg-st-h').map((h) => h.textContent),
    };
  });
  console.log(JSON.stringify(dump, null, 1));

  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/496-giro8-scuro.png`, fullPage: true });
  expect(dump.tessere.length).toBeGreaterThan(0);
});
