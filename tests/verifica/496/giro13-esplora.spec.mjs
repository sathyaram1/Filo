// Verifica #496 — giro 13. Esplorazione: superfici, tastiera, tasto destro,
// stato vuoto e stati limite, fotografati nei due temi.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g, h) => new Date(ora - g * 24 * 3600 * 1000 - (h || 0) * 3600 * 1000).toISOString();
const AG = (g) => `--- Aggiornamento dell'agente del ${String(g).padStart(2, '0')}/09/2026, 10:00 ---`;

function verbale(livelli) {
  const n = livelli.length;
  return [
    `Verifica: ${n} ${n === 1 ? 'rilievo' : 'rilievi'}.`,
    'Provato: tutto quanto.',
    'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
    ...livelli.map((l, i) => `- [${l}] rilievo ${i + 1}`),
  ].join('\n');
}
function conGiri(n) {
  const parti = [];
  for (let k = 0; k < n; k += 1) {
    parti.push(`${AG(k + 1)}\n${verbale([2, 1])}`);
    parti.push(`${AG(k + 2)}\nCorretto.`);
  }
  parti.push(`${AG(n + 3)}\nVerifica superata. Adesso funziona.`);
  return parti.join('\n\n');
}

const CLIENTI = ['tester@example.com', 'owner:tester@example.com', 'routine:prober', 'routine:verifier', 'agent:claude', 'routine:worker'];
const STATI = ['done', 'todo', 'working', 'attack', 'spam', 'design', 'unlabeled', 'archived'];

function dati(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const status = STATI[i % STATI.length];
    const done = status === 'done';
    out.push({
      _id: 'f' + i, seq: 400 + i, subSeq: 0,
      clientId: CLIENTI[i % CLIENTI.length],
      name: 'segnalazione numero ' + (400 + i),
      text: 'segnalazione numero ' + (400 + i),
      status,
      priority: (i % 4),
      createdAt: iso(i % 12, i % 20),
      _updateTime: iso((i % 12) / 2),
      resolvedInVersion: done ? '1.2.3' : undefined,
      notes: done ? conGiri(i % 7) : '',
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

test('ogni superficie della scheda risponde al tasto destro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate((l) => window.__mgTest.setData(l), dati(40));
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(300);

  const superfici = [
    ['tessera', '#mgStCards .mg-st-card'],
    ['pastiglia finestra', '#mgStWindows button'],
    ['pastiglia creatore', '#mgStCreators button'],
    ['riga altre misure', '#mgStMore li:first-child .mg-st-more-riga'],
    ['voce di legenda', '#mgStPieLegend li:first-child button, #mgStPieLegend li:first-child'],
    ['fetta di torta', '#mgStPie [data-drill]'],
    ['barretta', '#mgStBars [data-bucket], #mgStBars rect'],
    ['frase sotto la torta', '#mgStPieNote'],
    ['frase sotto il grafico', '#mgStBarsNote'],
    ['riga di avviso', '#mgStNote'],
    ['titolo di sezione', '#mgStPieBlock .mg-st-h'],
  ];

  const esiti = [];
  for (const [nome, sel] of superfici) {
    const el = page.locator(sel).first();
    if (!(await el.count())) { esiti.push(`${nome}: ASSENTE`); continue; }
    await el.click({ button: 'right' }).catch(() => {});
    await page.waitForTimeout(180);
    const voci = await page.evaluate(() => {
      const menu = document.querySelector('.sn-ctx, .sn-context-menu, [data-sn-ctx], .sn-menu');
      if (!menu || menu.hidden) return null;
      return Array.from(menu.querySelectorAll('button, [role="menuitem"], .sn-ctx-item'))
        .map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' / ');
    });
    esiti.push(`${nome}: ${voci === null ? 'NESSUN MENU' : voci}`);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(100);
  }
  console.log('TASTO DESTRO\n' + esiti.join('\n'));
});

test('la scheda con molti giri, fotografata', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate((l) => window.__mgTest.setData(l), dati(40));
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(300);
  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/496-giro13-chiaro.png', fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/496-giro13-scuro.png', fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'light'));

  // Stato vuoto: una finestra in cui non è arrivato niente.
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '2001-01-01', '2001-01-02'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'tests/.shots/496-giro13-vuoto.png', fullPage: true });
  const largh = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  expect(largh.doc, JSON.stringify(largh)).toBeLessThanOrEqual(largh.win + 1);
});

test('input limite: date impossibili, testo enorme, cambi a raffica', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  const lungo = 'x'.repeat(10000);
  const strani = [
    { _id: 'a', seq: 1, subSeq: 0, clientId: '<img src=x onerror=alert(1)>', name: lungo, text: lungo, status: 'done', createdAt: iso(1), _updateTime: iso(0), resolvedInVersion: '1.0.0', notes: verbale([3]) },
    { _id: 'b', seq: 2, subSeq: 0, clientId: 'tester@example.com', name: '😀"\'<script>alert(2)</script>', text: 'x', status: 'todo', createdAt: 'non-una-data', _updateTime: null, notes: null },
    { _id: 'c', seq: 3, subSeq: 0, clientId: 'routine:prober', name: 'nel futuro', text: 'x', status: 'done', createdAt: new Date(ora + 90 * 24 * 3600 * 1000).toISOString(), _updateTime: iso(0), resolvedInVersion: '1.0.0', notes: 12345 },
    { _id: 'd', seq: 4, subSeq: 0, clientId: 'routine:verifier', name: 'stato inventato', text: 'x', status: 'boh', createdAt: iso(3), _updateTime: iso(2), priority: 99, notes: '' },
  ];
  await page.evaluate((l) => window.__mgTest.setData(l), strani);
  for (const k of ['24h', '7d', '30d', '90d', 'all', '24h', 'all']) {
    await page.evaluate((w) => window.__mgTest.setStatsWindow(w), k);
  }
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '2026-13-45', '0000-00-00'));
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '2015-01-01', '2026-09-11'));
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(300);

  const testo = await page.evaluate(() => document.getElementById('panel-fbstats').innerText);
  expect(testo, testo.slice(0, 400)).not.toContain('NaN');
  expect(testo, testo.slice(0, 400)).not.toContain('undefined');
  expect(await page.evaluate(() => document.querySelectorAll('#panel-fbstats script').length)).toBe(0);
  const largh = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  expect(largh.doc, JSON.stringify(largh)).toBeLessThanOrEqual(largh.win + 1);
  console.log('LIMITE\n' + testo.replace(/\n{2,}/g, '\n').slice(0, 2000));
});
