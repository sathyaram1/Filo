// Verifica #496 — giro 10. Traccia visiva della scheda, tema chiaro e scuro,
// con dati veri di forma (una torta a più fette, il grafico, le misure).

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const OUT = 'tests/.shots';
const iso = (g) => new Date(Date.now() - g * 24 * 3600 * 1000).toISOString();
const AG = (g) => `--- Aggiornamento dell'agente del ${String(g).padStart(2, '0')}/09/2026, 10:00 ---`;

function verbale(n) {
  const righe = [`Verifica: ${n} ${n === 1 ? 'rilievo' : 'rilievi'}.`, 'Provato: tutto.'];
  righe.push('La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.');
  for (let i = 0; i < n; i += 1) righe.push(`- [${i % 4}] rilievo ${i + 1}`);
  return righe.join('\n');
}
function conGiri(k) {
  const parti = [];
  for (let i = 0; i < k; i += 1) {
    parti.push(i === 0 ? verbale(2) : `${AG(i + 1)}\n${verbale(2)}`);
    parti.push(`${AG(i + 1)}\nCorretto.`);
  }
  parti.push(`${AG(9)}\nVerifica superata. Provato tutto.`);
  return parti.join('\n\n');
}

const DATI = [
  { _id: 'v1', seq: 801, clientId: 'tester@example.com', text: 'a', status: 'done', createdAt: iso(9), _updateTime: iso(2), notes: conGiri(0), resolvedInVersion: '1.0.0' },
  { _id: 'v2', seq: 802, clientId: 'agent:prober', text: 'b', status: 'done', createdAt: iso(8), _updateTime: iso(2), notes: conGiri(1), resolvedInVersion: '1.0.0' },
  { _id: 'v3', seq: 803, clientId: 'agent:verifier', text: 'c', status: 'done', createdAt: iso(6), _updateTime: iso(1), notes: conGiri(2), resolvedInVersion: '1.0.0' },
  { _id: 'v4', seq: 804, clientId: 'owner:me', text: 'd', status: 'todo', createdAt: iso(4) },
  { _id: 'v5', seq: 805, clientId: 'tester@example.com', text: 'e', status: 'working', createdAt: iso(2) },
  { _id: 'v6', seq: 806, clientId: 'agent:prober', text: 'f', status: 'attack', createdAt: iso(1) },
];

test.beforeAll(() => { try { mkdirSync(OUT, { recursive: true }); } catch (_) { /* c'è già */ } });

test('traccia visiva della scheda, chiaro e scuro', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => {
    window.__mgTest.setData(d);
    window.__mgTest.renderWorkerLog([
      { role: 'prober', startedAt: new Date(Date.now() - 3600e3).toISOString(), num: '#1' },
      { role: 'prober', startedAt: new Date(Date.now() - 2 * 3600e3).toISOString(), num: '#2' },
      { role: 'verifier', startedAt: new Date(Date.now() - 5 * 3600e3).toISOString(), num: '#3' },
      { role: 'fixer', startedAt: new Date(Date.now() - 6 * 3600e3).toISOString(), num: '#4' },
    ]);
  }, DATI);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.waitForTimeout(250);
  await expect(page.locator('#mgStPieLegend li')).not.toHaveCount(0);

  await page.screenshot({ path: `${OUT}/496-giro10-chiaro.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/496-giro10-scuro.png`, fullPage: true });

  const stato = await page.evaluate(() => ({
    tessere: Array.from(document.querySelectorAll('.mg-st-card')).map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
    legenda: Array.from(document.querySelectorAll('#mgStPieLegend li')).map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
    nota: document.getElementById('mgStPieNote').textContent,
    misure: Array.from(document.querySelectorAll('.mg-st-more-riga')).map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    avviso: document.getElementById('mgStNote').textContent,
  }));
  console.log('SCHEDA:', JSON.stringify(stato, null, 1));
});
