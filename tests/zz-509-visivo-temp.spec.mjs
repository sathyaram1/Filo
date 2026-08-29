// TEMPORANEO — cattura visiva del caso "stato illeggibile" sulla dashboard di
// gestione, nei due temi e a finestra stretta. Va cancellato dopo averlo
// guardato: la traccia stabile vive in verify-509-avversariale.spec.mjs.

import { test } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const CODA = [
  { _id: 'k1', seq: 41, status: 'FENC1:aaaaaaaaaaaaaaaaaaaaaaaa', statusPublic: 'open', name: 'una segnalazione con un titolo lungo che deve andare in ellissi', text: 'uno', createdAt: '2026-08-01T10:00:00Z' },
  { _id: 'k2', seq: 42, status: 'FENC1:bbbbbbbbbbbbbbbbbbbbbbbb', statusPublic: 'closed', name: 'due', text: 'due', createdAt: '2026-08-02T10:00:00Z' },
  { _id: 'k3', seq: 43, status: 'FENC1:cccccccccccccccccccccccc', name: 'senza statusPublic', text: 'tre', createdAt: '2026-08-03T10:00:00Z' },
];

for (const tema of ['light', 'dark']) {
  test(`509 temp — manage cifrato ${tema}`, async ({ openTab }) => {
    const mg = await openTab(MANAGE);
    await mg.waitForLoadState('domcontentloaded');
    await mg.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
    await mg.evaluate(() => window.__mgTest.whenReady());
    await mg.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await mg.evaluate((items) => window.__mgTest.setData(items), CODA);
    await mg.locator('.mg-item').first().click();
    await mg.screenshot({ path: `tests/.shots/zz509-manage-cifrato-${tema}.png`, fullPage: true });
    await mg.setViewportSize({ width: 720, height: 700 });
    await mg.waitForTimeout(200);
    await mg.screenshot({ path: `tests/.shots/zz509-manage-cifrato-${tema}-720.png`, fullPage: true });
  });
}
