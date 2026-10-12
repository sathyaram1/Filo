// Verifica #429, giro 3, rilievo 6: con due schede la striscia scorre e la curva destra della scheda in
// primo piano, quando è l'ultima, finisce fuori dalla parte visibile.

import { test, expect } from '../../fixtures/electron.mjs';

test('r6 con due schede la striscia non ha niente da scorrere', async ({ shell, openTab }) => {
  const g = await openTab('filo://manage/manage.html');
  await g.waitForLoadState('load');
  await expect.poll(() => shell.locator('#tabs .tab').count(), { timeout: 10_000 }).toBe(2);
  await shell.waitForTimeout(1000);
  const s = await shell.evaluate(() => { const e = document.getElementById('tabs'); return { sw: e.scrollWidth, cw: e.clientWidth }; });
  expect(s.sw, `striscia ${s.sw} px in ${s.cw} visibili`).toBeLessThanOrEqual(s.cw);
});
