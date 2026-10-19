// Feedback #2 + #281: il passato dev'essere a portata di un clic da ogni pagina. Da #871 il pulsante sta in fondo alla
// barra laterale; dal #872 porta al quaderno delle memorie, che ha preso il posto della Cronologia (chat e schede
// chiuse stanno nel filo della home):
//   1) nella barra c'è il pulsante Memorie;
//   2) cliccandolo si apre davvero il quaderno.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo } from './helpers/barra.mjs';

test('la barra laterale ha un pulsante Memorie che apre il quaderno delle memorie', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);

  const bottone = barra.locator('#fisse [data-comando="history"]');
  await expect(bottone).toBeVisible();
  await expect(bottone).toHaveAttribute('aria-label', 'Memorie');

  await bottone.click();
  await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith('filo://quaderno/'); } catch (_) { return false; } }),
    { timeout: 10_000, message: 'il quaderno non si è aperto dopo il clic' }).toBe(true);
});
