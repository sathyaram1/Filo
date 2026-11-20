// Verifica #2272 giro 1, rilievo 1: al turno dopo il modello vede ancora gli id delle foto di prima, e citarli non
// mostra niente mentre il testo dice «eccola».

import { test, expect } from '../../fixtures/electron.mjs';
import { NEWTAB, preparaImmagini, stubModello, chiedi } from './aiuti.mjs';

test('r1 «rimettimi la seconda foto»: la foto del turno prima, citata col suo id, ricompare', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaImmagini(app, 3);
  await stubModello(app, [
    { strumento: { azione: 'immagini', query: 'antilope' } },
    { testo: 'Ecco.\n\n[[immagini: $ID0, $ID1, $ID2]]' },
    { testo: 'Eccola di nuovo:\n\n[[immagini: $ID1]]' },
  ]);
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  await expect(page.locator('.dash-bubble-filo .filo-galleria-img')).toHaveCount(3, { timeout: 30_000 });
  await chiedi(page, 'rimettimi la seconda foto da sola');
  const seconda = page.locator('.dash-bubble-filo', { hasText: 'Eccola di nuovo' });
  await expect(seconda).toBeVisible({ timeout: 30_000 });
  // Il modello, al secondo turno, ha davanti gli id del primo con l'invito a usarli.
  const visto = (await app.evaluate(() => globalThis.__visti)).slice(-1)[0];
  expect(visto).toMatch(/Immagini dal web scaricate da Filo, 3 \(i\d+, i\d+, i\d+\)/);
  await expect(seconda.locator('.filo-galleria-img')).toHaveCount(1);
});
