// Verifica #496 — giro 8. Le strade equivalenti sulla scheda: il tasto destro
// e la tastiera dove il clic funziona, e i numeri di «Altre misure» che non
// portano a niente mentre tutti gli altri numeri della scheda ci portano.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const OUT = 'tests/.shots';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();

function seed() {
  const l = [];
  [0, 1, 2].forEach((g, i) => {
    const b = [];
    let t = 0;
    // Ogni nota è un turno suo: è così che Filo appende il verbale e il report
    // di chi corregge.
    const turno = () => `--- Aggiornamento dell'agente del 07/09/2026, ${t += 1} ---`;
    for (let k = 0; k < g; k += 1) {
      if (k) b.push(turno());
      b.push('Verifica: 1 rilievo.', 'Provato: tutto.',
        'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
        '- [1] Un rilievo', '', turno(), 'Corretto.', '');
    }
    if (g) b.push(turno());
    b.push('Verifica superata.');
    l.push({
      _id: `w${i}`, seq: 400 + i, subSeq: 0, clientId: 'tester@example.com',
      name: `lavorazione ${i}`, text: `lavorazione ${i}`, status: 'done',
      createdAt: iso(9 + i), _updateTime: iso(1), notes: b.join('\n'),
    });
  });
  ['attack', 'spam', 'todo'].forEach((s, i) => l.push({
    _id: `s${i}`, seq: 500 + i, subSeq: 0, clientId: 'utente@example.com',
    name: `segnalazione ${s}`, text: `segnalazione ${s}`, status: s, createdAt: iso(i),
  }));
  return l;
}

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => window.__mgTest.setData(l), seed());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(150);
}

test.beforeAll(() => { try { mkdirSync(OUT, { recursive: true }); } catch (_) { /* c'è già */ } });

test('«Altre misure»: un numero di segnalazioni si apre su quali sono', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const riga = page.locator('#mgStMore li').filter({ hasText: 'fermate dai giudici' });
  await expect(riga).toHaveCount(1);
  await riga.click();
  await page.waitForTimeout(200);
  await riga.click({ button: 'right' });
  await page.waitForTimeout(250);

  const dopo = await page.evaluate(() => ({
    elenco: !!document.querySelector('#panel-fbstats .mg-st-drill'),
    menu: Array.from(document.querySelectorAll('.mg-ctxmenu, .sn-select-pop')).map((m) => m.textContent).join(' | '),
  }));
  await page.screenshot({ path: `${OUT}/496-giro8-altre-misure.png`, fullPage: true });
  const porta = dopo.elenco || /contate|mostra|copia riga/i.test(dopo.menu);
  expect(porta, `menu visto: ${dopo.menu}`).toBe(true);
});

test('la torta e il grafico si raggiungono anche da tastiera', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const tastiera = await page.evaluate(() => {
    const fetta = document.querySelector('#mgStPie [data-group]');
    const barra = document.querySelector('#mgStBars rect.mg-st-bar');
    const focus = (el) => {
      if (!el) return null;
      try { el.focus(); } catch (_) { /* non focalizzabile */ }
      return document.activeElement === el;
    };
    return {
      fettaTab: fetta ? fetta.getAttribute('tabindex') : null,
      barraTab: barra ? barra.getAttribute('tabindex') : null,
      fettaFocus: focus(fetta),
      barraFocus: focus(barra),
    };
  });
  expect(tastiera.fettaFocus, JSON.stringify(tastiera)).toBe(true);
  expect(tastiera.barraFocus, JSON.stringify(tastiera)).toBe(true);
});
