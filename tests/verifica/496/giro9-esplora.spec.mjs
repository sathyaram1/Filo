// Verifica #496 — giro 9. Esplorazione della scheda: superfici che rispondono
// e superfici che tacciono, stato vuoto, tema chiaro e scuro, finestra stretta.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const OUT = 'tests/.shots';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();
const AG = '--- Aggiornamento dell\'agente del 01/09/2026, 10:00 ---';

function lavorazione(id, seq, giri) {
  const b = [];
  for (let k = 0; k < giri; k += 1) {
    b.push('Verifica: 1 rilievo.', 'Provato: tutto.',
      'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
      '- [1] Un rilievo', '', AG, 'Corretto.', '');
  }
  b.push('Verifica superata.');
  return {
    _id: id, seq, subSeq: 0, clientId: 'tester@example.com',
    name: `lavorazione da ${giri} giri`, text: 'x', status: 'done',
    createdAt: iso(9), _updateTime: iso(1), notes: b.join('\n'),
  };
}

function seed() {
  const l = [0, 1, 2, 3, 5].map((g, i) => lavorazione(`w${i}`, 400 + i, g));
  ['attack', 'spam', 'todo', 'working', 'design', 'unlabeled'].forEach((s, i) => l.push({
    _id: `s${i}`, seq: 500 + i, subSeq: 0,
    clientId: i % 2 ? 'routine:prober' : 'utente@example.com',
    name: `segnalazione ${s}`, text: `segnalazione ${s}`, status: s, createdAt: iso(i),
  }));
  return l;
}

const LOG = [
  { role: 'prober', startedAt: iso(1), num: '#1' },
  { role: 'prober', startedAt: iso(2), num: '#2' },
  { role: 'verifier', startedAt: iso(1), num: '#3' },
  { role: 'new-work', startedAt: iso(3), num: '#4' },
  { role: 'ruolo-nuovo', startedAt: iso(1), num: '#5' },
];

async function apri(page, dati) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => window.__mgTest.setData(l), dati === undefined ? seed() : dati);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate((entries) => {
    window.__mgTest.renderWorkerLog(entries);
    window.__mgTest.setStatsWindow('all');
  }, LOG);
  await page.waitForTimeout(200);
}

test.beforeAll(() => { try { mkdirSync(OUT, { recursive: true }); } catch (_) { /* c'è già */ } });

test('esplorazione: chi risponde al tasto destro e chi no', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  // Tutte le righe della scheda, e cosa promettono.
  const superfici = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#panel-fbstats .mg-st-row, #panel-fbstats .mg-st-more-riga').forEach((el) => {
      out.push({
        testo: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60),
        tag: el.tagName,
        drill: el.dataset.drill || '',
        copia: el.dataset.copia || '',
      });
    });
    return out;
  });
  console.log('SUPERFICI', JSON.stringify(superfici, null, 1));

  // Il tasto destro su una riga della tessera «Prober lanciati».
  await page.evaluate(() => {
    const card = document.querySelector('[data-card="routine"]');
    const head = card && card.querySelector('[data-card-toggle]');
    if (head && head.getAttribute('aria-expanded') !== 'true') head.click();
  });
  await page.waitForTimeout(150);
  const riga = page.locator('[data-card="routine"] .mg-st-row').first();
  await expect(riga).toHaveCount(1);
  await riga.click({ button: 'right' });
  await page.waitForTimeout(200);
  const menu = await page.evaluate(() => Array.from(document.querySelectorAll('.mg-ctxmenu, .sn-select-pop'))
    .map((m) => m.textContent).join(' | '));
  console.log('MENU SU UNA RIGA DI «PROBER LANCIATI»:', JSON.stringify(menu));

  await page.screenshot({ path: `${OUT}/496-giro9-chiaro.png`, fullPage: true });
});

test('esplorazione: tema scuro, stato vuoto, finestra stretta', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/496-giro9-scuro.png`, fullPage: true });

  await page.setViewportSize({ width: 620, height: 900 });
  await page.waitForTimeout(200);
  const sbordo = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  console.log('LARGHEZZA A 620:', JSON.stringify(sbordo));
  await page.screenshot({ path: `${OUT}/496-giro9-stretta.png`, fullPage: true });

  await page.setViewportSize({ width: 1200, height: 900 });
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/496-giro9-vuoto.png`, fullPage: true });
  const vuoto = await page.evaluate(() => document.querySelector('#panel-fbstats .mg-st').innerText);
  console.log('STATO VUOTO:\n', vuoto);
});
