// Verifica #496 — giro 11. Uno sguardo alla scheda piena, nei due temi e a
// finestra stretta: la traccia visiva del giro.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();
const AG = (g) => `--- Aggiornamento dell'agente del ${String(g).padStart(2, '0')}/09/2026, 10:00 ---`;

function verbale(n) {
  return [
    `Verifica: ${n} ${n === 1 ? 'rilievo' : 'rilievi'}.`,
    'Provato: tutto quanto.',
    'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
    ...Array.from({ length: n }, (_, i) => `- [${i % 3}] rilievo ${i + 1}`),
  ].join('\n');
}
function conversazione(giri) {
  const parti = [];
  for (let i = 0; i < giri; i += 1) {
    parti.push(i === 0 ? verbale(2) : `${AG(i * 2 + 1)}\n${verbale(2)}`);
    parti.push(`${AG(i * 2 + 2)}\nCorretto.`);
  }
  parti.push(`${AG(giri * 2 + 1)}\nVerifica superata. Adesso funziona.`);
  return parti.join('\n\n');
}

const DATI = [
  { _id: 'a', seq: 901, clientId: 'tester@example.com', name: 'passata subito', text: 'passata subito', status: 'done', createdAt: iso(20), _updateTime: iso(3), notes: conversazione(0) },
  { _id: 'b', seq: 902, clientId: 'routine:prober', name: 'un giro', text: 'un giro', status: 'done', createdAt: iso(15), _updateTime: iso(2), notes: conversazione(1) },
  { _id: 'c', seq: 903, clientId: 'routine:verifier', name: 'due giri', text: 'due giri', status: 'done', createdAt: iso(10), _updateTime: iso(2), notes: conversazione(2) },
  { _id: 'd', seq: 904, clientId: 'tester@example.com', name: 'in coda', text: 'in coda', status: 'todo', createdAt: iso(4) },
  { _id: 'e', seq: 905, clientId: 'tester@example.com', name: 'un attacco', text: 'un attacco', status: 'attack', createdAt: iso(1) },
];

test('la scheda piena, tema chiaro e tema scuro, larga e stretta', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate((d) => window.__mgTest.setData(d), DATI);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(200);

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(120);
    await page.screenshot({ path: `tests/.shots/496-giro11-${tema}.png`, fullPage: true });
  }

  // Stretta: nessuno scorrimento orizzontale.
  await page.setViewportSize({ width: 620, height: 900 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'tests/.shots/496-giro11-stretta.png', fullPage: true });
  const sborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(sborda).toBe(false);
});
