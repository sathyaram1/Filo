// Verifica #496 — giro 12. Esplorazione: la scheda con dati verosimili,
// fotografata nei due temi e a finestra stretta. Non asserisce quasi niente:
// serve a guardare.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g, h) => new Date(ora - g * 24 * 3600 * 1000 - (h || 0) * 3600 * 1000).toISOString();
const AG = (g) => `--- Aggiornamento dell'agente del ${String(g).padStart(2, '0')}/09/2026, 10:00 ---`;

function verbale(riassunto, livelli) {
  const n = livelli.length;
  const righe = [`Verifica: ${n} ${n === 1 ? 'rilievo' : 'rilievi'}.`];
  if (riassunto) righe.push(riassunto);
  righe.push('La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.');
  livelli.forEach((l, i) => righe.push(`- [${l}] rilievo ${i + 1}`));
  return righe.join('\n');
}
function conGiri(n) {
  const parti = [];
  for (let k = 0; k < n; k += 1) {
    parti.push(verbale('Provato: tutto quanto, e anche le porte del giro scorso.', [2, 1]));
    parti.push(`${AG(k + 2)}\nCorretto.`);
  }
  parti.push(`${AG(n + 2)}\nVerifica superata. Adesso funziona.`);
  return parti.join('\n\n');
}

const CLIENTI = ['tester@example.com', 'owner:tester@example.com', 'routine:prober', 'routine:verifier', 'agent:claude', 'routine:worker'];
const STATI = ['done', 'todo', 'working', 'attack', 'spam', 'design', 'unlabeled', 'archived'];

function dati() {
  const out = [];
  for (let i = 0; i < 40; i += 1) {
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
      notes: done ? conGiri(i % 6) : '',
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

test('fotografie della scheda con dati verosimili', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate((l) => window.__mgTest.setData(l), dati());
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(300);

  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/496-giro12-chiaro.png', fullPage: true });

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/496-giro12-scuro.png', fullPage: true });

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.setViewportSize({ width: 620, height: 900 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/496-giro12-stretto.png', fullPage: true });

  const largh = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }));
  expect(largh.doc, JSON.stringify(largh)).toBeLessThanOrEqual(largh.win + 1);
});
