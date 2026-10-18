// Gestione: un rientro per riallineamento dopo un conflitto di fusione non si presenta come una bocciatura (#532).
// Il server scrive `statusReason: riallineamento` con lo stato e `motivo` sulla voce del registro dei worker:
// scheda in coda, dettaglio e riga di log dicono «Riallineamento», una correzione vera resta «Correzione».

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const RIALLINEATO = {
  _id: 'q-rial', text: 'il lavoro aveva passato verifica e audit', name: 'Rientrato per conflitto', seq: 509, subSeq: 0,
  status: 'revision_capability', statusReason: 'riallineamento', priority: 0, createdAt: '2026-09-03T10:00:00Z',
};
const BOCCIATO = {
  _id: 'q-boc', text: 'il verificatore ha trovato un difetto', name: 'Bocciato', seq: 510, subSeq: 0,
  status: 'revision_capability', priority: 0, createdAt: '2026-09-03T11:00:00Z',
};

test('#532: in coda il riallineamento si legge come tale, la correzione come prima', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);

  await page.evaluate((fbs) => {
    window.__mgTest.setData(fbs);
    window.__mgTest.setTab('queue');
  }, [RIALLINEATO, BOCCIATO]);

  const rial = page.locator('#mgList .mg-item[data-id="q-rial"]');
  const boc = page.locator('#mgList .mg-item[data-id="q-boc"]');
  await expect(rial.locator('.mg-step--current')).toHaveText('● Riallineamento');
  await expect(rial.locator('.mg-item-state')).toContainText('il riallineamento riparte da solo');
  await expect(rial.locator('.mg-item-state')).not.toContainText('Controllo funzionalità');
  await expect(rial).toHaveAttribute('title', /main è andato avanti, non è una bocciatura/);

  await expect(boc.locator('.mg-step--current')).toHaveText('● Controllo funzionalità');
  await expect(boc.locator('.mg-item-state')).toContainText('in attesa di un verificatore');
  await expect(boc).not.toHaveAttribute('title', /bocciatura/);

  await page.evaluate(() => window.__mgTest.openDetail('q-rial'));
  await expect(page.locator('#mgWorkState')).toContainText('Riallineamento');
  await expect(page.locator('#mgWorkState')).not.toContainText('Controllo funzionalità');
  await rial.screenshot({ path: 'tests/.shots/532-scheda-riallineamento.png' });
});

test('#532: nel log il rebase dopo un conflitto e la sua verifica non si leggono come correzione', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderWorkerLog);

  await page.evaluate(() => window.__mgTest.setTab('log'));
  await page.evaluate((entries) => window.__mgTest.renderWorkerLog(entries), [
    { role: 'verifier', startedAt: '2026-09-03T17:30:00.000Z', num: '509', motivo: 'riallineamento' },
    { role: 'fixer', startedAt: '2026-09-03T17:00:00.000Z', num: '509', motivo: 'riallineamento' },
    { role: 'fixer', startedAt: '2026-09-03T16:00:00.000Z', num: '510' },
    { role: 'fixer', startedAt: '2026-09-03T15:00:00.000Z', num: '511', motivo: 'un-motivo-nuovo' },
  ]);

  const ruoli = page.locator('#mgLogList .mg-log-row .mg-log-role');
  await expect(ruoli).toHaveText(['Verifica del riallineamento', 'Riallineamento', 'Correzione', 'Correzione']);
  await page.locator('#mgLogList').screenshot({ path: 'tests/.shots/532-log-riallineamento.png' });
});
