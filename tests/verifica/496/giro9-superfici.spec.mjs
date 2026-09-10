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
  let t = 0;
  // Ogni nota è un turno suo: è così che Filo appende il verbale e il report di
  // chi corregge.
  const turno = () => `${AG} ${t += 1}`;
  for (let k = 0; k < giri; k += 1) {
    if (k) b.push(turno());
    b.push('Verifica: 1 rilievo.', 'Provato: tutto.',
      'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
      '- [1] Un rilievo', '', turno(), 'Corretto.', '');
  }
  if (giri) b.push(turno());
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
  const muti = [
    ['riga di «Prober lanciati»', riga],
    ['nota sotto la torta', nota],
    ['nota sotto il grafico', barre],
  ].filter(([, m]) => generale.test(m) || !/Copia|contate/i.test(m));
  expect(muti.map(([n]) => n).join(', '), JSON.stringify({ riga, nota, barre })).toBe('');

  // Traccia visiva del giro, chiaro e scuro.
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${OUT}/496-giro9-chiaro.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/496-giro9-scuro.png`, fullPage: true });
});

test('la ripartizione di una tessera ripartisce il numero della tessera', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate(() => {
    const head = document.querySelector('[data-card="routine"] [data-card-toggle]');
    if (head && head.getAttribute('aria-expanded') !== 'true') head.click();
  });
  await page.waitForTimeout(200);
  const t = await page.evaluate(() => {
    const card = document.querySelector('[data-card="routine"]');
    return {
      numero: Number(card.querySelector('.mg-st-card-value').textContent.replace('+', '')),
      sub: card.querySelector('.mg-st-card-sub').textContent,
      righe: Array.from(card.querySelectorAll('.mg-st-row')).map((r) => ({
        label: r.querySelector('.mg-st-row-label').textContent,
        n: Number(r.querySelector('.mg-st-row-n').textContent),
        share: r.querySelector('.mg-st-row-share').textContent,
      })),
    };
  });
  const somma = t.righe.reduce((a, r) => a + r.n, 0);
  // Le altre tre tessere si aprono sulla ripartizione del LORO numero. Questa
  // apre su tutti i ruoli, e le percentuali sono quote di quel totale: aprire
  // «1 Prober lanciati» e leggere «Verifica 1 · 50%» senza che 2 sia scritto
  // da nessuna parte è la stessa tessera che si legge in due modi.
  expect(somma, JSON.stringify(t)).toBeGreaterThan(0);
  expect(t.sub, JSON.stringify(t)).toContain(String(somma));
  // E il numero grande dev'essere una delle righe, o non si vede da dove viene.
  expect(t.righe.some((r) => r.n === t.numero), JSON.stringify(t)).toBe(true);
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

test('con poche colonne il grafico non lascia mezzo riquadro bianco', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate(() => window.__mgTest.setStatsWindow('24h'));
  await page.waitForTimeout(250);
  await page.locator('#mgStBarsBlock').screenshot({ path: `${OUT}/496-giro9-poche-colonne.png` });
  const uso = await page.evaluate(() => {
    const svg = document.getElementById('mgStBars');
    const box = svg.getBoundingClientRect();
    const disegnato = Array.from(svg.querySelectorAll('rect.mg-st-bar, line.mg-st-bar-base, text'))
      .map((el) => el.getBoundingClientRect())
      .reduce((a, r) => Math.max(a, r.right - box.left), 0);
    return { largo: Math.round(box.width), usato: Math.round(disegnato) };
  });
  // Un grafico che si ferma a un terzo del suo riquadro non è un andamento:
  // sono due rettangoli appoggiati a sinistra, col resto bianco.
  expect(uso.usato, JSON.stringify(uso)).toBeGreaterThan(uso.largo * 0.6);
});
