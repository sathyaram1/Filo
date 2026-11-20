// r4: fermata la risposta a metà, le foto già citate nella parte scritta restano a schermo (riaperta la chat ci sono).
import { test, expect } from '../../fixtures/electron.mjs';
import { NEWTAB, preparaImmagini, stubModello, rispostaLenta, chiedi } from './aiuti.mjs';

test('r4 dopo «Ferma» le foto della parte già scritta si vedono', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaImmagini(app, 2);
  await stubModello(app, [{ strumento: { azione: 'immagini', query: 'antilope' } }, { testo: 'x' }]);
  await rispostaLenta(app);
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Ecco le antilopi' });
  await expect(bolla).toContainText('Testo lungo che continua', { timeout: 30_000 });
  await page.locator('#stopBtn, [aria-label="Ferma"], [data-tip="Ferma"]').first().click();
  await expect(page.getByText('Fermato a metà della risposta')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco le antilopi' }).locator('.filo-galleria-img')).toHaveCount(2, { timeout: 5000 });
});
