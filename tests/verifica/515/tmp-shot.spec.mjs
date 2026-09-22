// Cattura visiva del giro 3 — si cancella prima di consegnare.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = 'filo://transparency/transparency.html';

test('barra e pagina di una sezione non scritta', async ({ openTab }) => {
  const a = await openTab(PAGINA);
  await expect(a.locator('#title')).toBeVisible({ timeout: 10_000 });
  await a.locator('#nav .is-soon').first().hover();
  await a.waitForTimeout(300);
  await a.screenshot({ path: 'tests/.shots/515-g3-barra.png', clip: { x: 0, y: 0, width: 1270, height: 220 } });

  const b = await openTab(`${PAGINA}?doc=privacy`);
  await expect(b.locator('#title')).toBeVisible({ timeout: 10_000 });
  await b.screenshot({ path: 'tests/.shots/515-g3-privacy.png', clip: { x: 0, y: 0, width: 1270, height: 320 } });
});
