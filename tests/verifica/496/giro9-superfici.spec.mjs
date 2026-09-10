// Verifica #496 — giro 9. Le superfici della scheda che portano un numero e
// non rispondono, e il grafico degli arrivi quando la finestra si stringe.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const OUT = 'tests/.shots';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();
const AG = '--- Aggiornamento dell\'agente del 01/09/2026, 10:00 ---';

function lavorazione(id, seq, giri, giorni) {
  const b = [];
  for (let k = 0; k < giri; k += 1) {
    b.push('Verifica: 1 rilievo.', 'Provato: tutto.',
      'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
      '- [1] Un rilievo', '', AG, 'Corretto.', '');
  }
  b.push('Verifica superata.');
  return {
    _id: id, seq, subSeq: 0, clientId: 'tester@example.com',
    name: `lavorazione ${seq}`, text: 'x', status: 'done',
    createdAt: iso(giorni), _updateTime: iso(0), notes: b.join('\n'),
  };
}

const DATI = [0, 1, 2].map((g, i) => lavorazione(`w${i}`, 400 + i, g, i));
const LOG = [
  { role: 'prober', startedAt: iso(0), num: '#1' },
  { role: 'verifier', startedAt: iso(0), num: '#2' },
];

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => window.__mgTest.setData(l), DATI);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate((entries) => {
    window.__mgTest.renderWorkerLog(entries);
    window.__mgTest.setStatsWindow('all');
  }, LOG);
  await page.waitForTimeout(200);
}

// Quale menu è uscito: quello della scheda, o quello generale della pagina?
async function menuDopoTastoDestro(page, selettore) {
  await page.evaluate(() => {
    document.querySelectorAll('.mg-ctxmenu, .sn-select-pop, .sn-menu, [role="menu"]').forEach((m) => m.remove());
  });
  await page.locator(selettore).first().click({ button: 'right' });
  await page.waitForTimeout(250);
  return page.evaluate(() => Array.from(document.querySelectorAll('[role="menu"], .mg-ctxmenu, .sn-select-pop'))
    .map((m) => m.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '));
}

test.beforeAll(() => { try { mkdirSync(OUT, { recursive: true }); } catch (_) { /* c'è già */ } });

test('ogni riga che porta un numero risponde al tasto destro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  // Apre la ripartizione di «Prober lanciati».
  await page.evaluate(() => {
    const head = document.querySelector('[data-card="routine"] [data-card-toggle]');
    if (head && head.getAttribute('aria-expanded') !== 'true') head.click();
  });
  await page.waitForTimeout(200);

  const riga = await menuDopoTastoDestro(page, '[data-card="routine"] .mg-st-row');
  const nota = await menuDopoTastoDestro(page, '#mgStPieNote');
  const barre = await menuDopoTastoDestro(page, '#mgStBarsNote');
  console.log('MENU riga «Prober lanciati»:', JSON.stringify(riga));
  console.log('MENU nota della torta   :', JSON.stringify(nota));
  console.log('MENU nota del grafico   :', JSON.stringify(barre));

  const generale = /Invia feedback|Invia attacco|Aiuto/i;
  expect(riga, `menu: ${riga}`).not.toMatch(generale);
  expect(riga, `menu: ${riga}`).toMatch(/Copia|contate/i);
});

test('il grafico degli arrivi resta leggibile a finestra stretta', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const misura = async () => page.evaluate(() => {
    const svg = document.getElementById('mgStBars');
    const t = svg && svg.querySelector('text.mg-st-bar-axis');
    if (!t) return null;
    const box = svg.getBoundingClientRect();
    const r = t.getBoundingClientRect();
    return {
      svgW: Math.round(box.width),
      // Quanto è larga l'etichetta sullo schermo, e quanto lo sarebbe senza
      // deformazione (il viewBox è 1000 unità, `preserveAspectRatio="none"`).
      etichetta: Math.round(r.width),
      testo: t.textContent,
      preserve: svg.getAttribute('preserveAspectRatio'),
    };
  });

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(200);
  const largo = await misura();
  await page.setViewportSize({ width: 620, height: 900 });
  await page.waitForTimeout(250);
  const stretto = await misura();
  await page.locator('#mgStBarsBlock').screenshot({ path: `${OUT}/496-giro9-assi-stretti.png` });
  console.log('ASSI larga:', JSON.stringify(largo), '\nASSI stretta:', JSON.stringify(stretto));

  // La stessa scritta, la stessa dimensione: un'etichetta che si schiaccia col
  // riquadro è testo deformato, non testo rimpicciolito.
  expect(stretto.etichetta, `${largo.etichetta} → ${stretto.etichetta}`).toBeGreaterThan(largo.etichetta * 0.9);
});

test('il grafico con due sole colonne si legge come un andamento', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('24h'));
  await page.waitForTimeout(250);
  await page.locator('#mgStBarsBlock').screenshot({ path: `${OUT}/496-giro9-poche-colonne.png` });
  const info = await page.evaluate(() => {
    const svg = document.getElementById('mgStBars');
    return {
      barre: Array.from(svg.querySelectorAll('rect.mg-st-bar')).map((r) => ({
        x: r.getAttribute('x'), w: r.getAttribute('width'),
      })),
      etichette: Array.from(svg.querySelectorAll('text')).map((t) => t.textContent),
      nota: document.getElementById('mgStBarsNote').textContent,
    };
  });
  console.log('POCHE COLONNE:', JSON.stringify(info));
});
