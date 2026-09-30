// Verifica #428, giro 1, rilievo 1: chiusa con la X la scheda attiva (più larga delle altre) col
// puntatore sulla fila, il clic seguente nello stesso punto deve chiudere un'altra scheda, e la
// scheda che diventa attiva non deve restare più stretta del minimo di una scheda attiva.

import { test, expect } from '../../fixtures/electron.mjs';

const QUANTE = 12;

async function preparaConAttivaInMezzo(shell) {
  await shell.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await window.filoShell.tabs.open('filo://newtab/');
  }, QUANTE - 1);
  await expect(shell.locator('#tabs .tab')).toHaveCount(QUANTE, { timeout: 15_000 });
  const scheda = shell.locator('#tabs .tab').nth(4);
  await scheda.hover();
  await scheda.click();
  await expect(scheda).toHaveClass(/active/);
  const x = await shell.evaluate(() => {
    const r = document.querySelector('#tabs .tab.active .close').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await shell.mouse.move(x.x, x.y);
  return x;
}

test('chiusa la scheda attiva con la X, un secondo clic nello stesso punto chiude un’altra scheda', async ({ shell }) => {
  const x = await preparaConAttivaInMezzo(shell);
  await shell.mouse.click(x.x, x.y);
  await expect(shell.locator('#tabs .tab')).toHaveCount(QUANTE - 1);
  await shell.mouse.click(x.x, x.y);
  await expect(shell.locator('#tabs .tab')).toHaveCount(QUANTE - 2);
});

test('chiusa la scheda attiva con la X, quella che diventa attiva non resta più stretta di una scheda attiva', async ({ shell }) => {
  const x = await preparaConAttivaInMezzo(shell);
  await shell.mouse.click(x.x, x.y);
  await expect(shell.locator('#tabs .tab')).toHaveCount(QUANTE - 1);
  await expect.poll(() => shell.evaluate(() => {
    const el = document.querySelector('#tabs .tab.active');
    return el ? Math.round(el.getBoundingClientRect().width) : 0;
  })).toBeGreaterThanOrEqual(110);
});
