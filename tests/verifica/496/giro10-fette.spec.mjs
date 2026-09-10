// Verifica #496 — giro 10. L'etichetta della fetta e i rilievi che ci sono
// dentro: la segnalazione chiedeva «quanti di questi sono fail e quanti
// migliorabile», e una lavorazione passata col vecchio «migliorabile» ha preso
// dei rilievi, non zero.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const iso = (g) => new Date(Date.now() - g * 24 * 3600 * 1000).toISOString();

// Il verbale di un giro i cui rilievi vanno in un feedback derivato: è la forma
// esatta che scrive il server (SN_VERIFIER_ROUND.roundNote con decision.fix
// vuoto), cioè il vecchio «migliorabile».
const RIMANDATI = [
  'Verifica: 3 rilievi.',
  'Provato tutto: la cosa chiesta si ottiene.',
  'Nessun rilievo da correggere adesso: il lavoro prosegue e i rilievi vanno in un feedback derivato.',
  '- [1] manca l’hover sull’icona',
  '- [0] il bordo è freddo',
  '- [0] la finestra sotto i 300 pixel',
].join('\n');

test('una lavorazione passata con tre rilievi rimandati non si chiama «0 critiche»', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();

  await page.evaluate((d) => {
    window.__mgTest.setData([{
      _id: 'r1', seq: 810, subSeq: 0, clientId: 'tester@example.com',
      text: 'una lavorazione', status: 'done',
      createdAt: d.vecchio, _updateTime: d.recente, notes: d.notes,
    }]);
  }, { vecchio: iso(5), recente: iso(1), notes: RIMANDATI });
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(150);

  const stato = await page.evaluate(() => ({
    legenda: Array.from(document.querySelectorAll('#mgStPieLegend li')).map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
    nota: document.getElementById('mgStPieNote').textContent,
    misure: Array.from(document.querySelectorAll('.mg-st-more-riga')).map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
  }));
  console.log('RIMANDATI:', JSON.stringify(stato, null, 1));

  // La riga sotto dichiara 3 rilievi e un giro con rilievi rimandati: la fetta
  // che li contiene non può chiamarsi «0 critiche».
  expect(stato.misure.join(' '), stato.misure.join(' ')).toContain('0 · 0 · 1 · 2');
  expect(stato.legenda.join(' | '), stato.legenda.join(' | ')).not.toContain('0 critiche');
});
