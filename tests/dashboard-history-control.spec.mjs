// Feedback #2 + #281: la cronologia dev'essere a portata di un clic da ogni pagina. Con #281 la
// pagina PRINCIPALE di cronologia è quella delle schede visitate/chiuse (filo://archive), non il log
// delle azioni AI. Da #871 il pulsante sta in fondo alla barra laterale, non più in alto nella home:
//   1) nella barra c'è il pulsante Cronologia;
//   2) cliccandolo si apre davvero la pagina della cronologia schede (filo://archive).

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo } from './helpers/barra.mjs';

test('la barra laterale ha un pulsante Cronologia che apre la cronologia schede', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);

  const histBtn = barra.locator('#fisse [data-comando="history"]');
  await expect(histBtn).toBeVisible();
  await expect(histBtn).toHaveAttribute('aria-label', 'Cronologia');

  await histBtn.click();
  const deadline = Date.now() + 10_000;
  let opened = null;
  while (Date.now() < deadline) {
    opened = app.windows().find((w) => w.url().includes('filo://archive/'));
    if (opened) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(opened, 'la pagina cronologia schede non si è aperta dopo il click').toBeTruthy();
});
