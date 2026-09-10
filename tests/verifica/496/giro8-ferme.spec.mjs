// Verifica #496 — giro 8. Le lavorazioni chiuse SENZA un pass registrato (il
// verificatore ha fermato il lavoro e l'owner l'ha chiuso a mano). Sono
// lavorazioni chiuse a tutti gli effetti: la sezione della torta non può
// scrivere che in questa finestra non ce n'è nessuna.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const OUT = 'tests/.shots';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();

// Il verbale di un giro che FERMA il lavoro, come lo scrive il server.
const fermata = [
  'Verifica: 1 rilievo.',
  'Provato: tutto quanto.',
  'Il lavoro si ferma: c\'è un rilievo di livello 2 o 3 che non si può correggere da soli (bilancio esaurito, o chiede una tua decisione).',
  '- [2] La cosa chiesta non si ottiene',
].join('\n');

test.beforeAll(() => { try { mkdirSync(OUT, { recursive: true }); } catch (_) { /* c'è già */ } });

test('una lavorazione chiusa senza pass non diventa «nessuna lavorazione chiusa»', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ n, c, u }) => window.__mgTest.setData([{
    _id: 'f1', seq: 1, subSeq: 0, clientId: 'u@e.com',
    name: 'lavorazione fermata', text: 'lavorazione fermata',
    status: 'done', createdAt: c, _updateTime: u, notes: n,
  }]), { n: fermata, c: iso(5), u: iso(1) });
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(200);

  const f = await page.evaluate(() => ({
    lavorati: document.querySelector('.mg-st-card[data-card="lavorati"] .mg-st-card-value').textContent.trim(),
    torta: document.getElementById('mgStPieLegend').textContent,
    note: document.getElementById('mgStPieNote').textContent,
  }));
  await page.screenshot({ path: `${OUT}/496-giro8-ferme.png`, fullPage: true });
  console.log(JSON.stringify(f, null, 1));

  expect(f.lavorati).toBe('1');
  // La tessera sopra dice 1 e la riga sotto dice «1 lavorazione chiusa senza un
  // pass registrato»: in mezzo non ci può stare «nessuna lavorazione chiusa».
  expect(f.torta).not.toMatch(/Nessuna lavorazione chiusa/i);
});
