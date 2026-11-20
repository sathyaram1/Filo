// r1: una foto sola, larga come una foto normale (16:9), deve stare tutta dentro la risposta, non tagliata a destra.
import { test, expect } from '../../fixtures/electron.mjs';
import { NEWTAB, preparaImmagini, stubModello, chiedi } from './aiuti.mjs';

test('r1 una foto larga da sola sta tutta nella risposta', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaImmagini(app, 1, { w: 800, h: 450 });
  await stubModello(app, [{ strumento: { azione: 'immagini', query: 'savana' } }, { testo: 'Ecco la savana.\n\n[[immagine: $ID0]]\n\nBella.' }]);
  const page = await openTab(NEWTAB);
  await chiedi(page, 'savana immagine');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Ecco la savana.' });
  const img = bolla.locator('.filo-galleria-img');
  await expect(img).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(() => img.evaluate((e) => e.complete && e.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
  await page.screenshot({ path: 'tests/.shots/2272-g2-r1-foto-larga.png' }).catch(() => {});
  const misure = await bolla.evaluate((b) => {
    const s = b.querySelector('.filo-galleria-scorre');
    const i = b.querySelector('.filo-galleria-img').getBoundingClientRect();
    const r = b.getBoundingClientRect();
    return { destraFoto: Math.round(i.right), destraBolla: Math.round(r.right), scorre: s.scrollWidth - s.clientWidth };
  });
  expect(misure.scorre, JSON.stringify(misure)).toBeLessThanOrEqual(1);
  expect(misure.destraFoto, JSON.stringify(misure)).toBeLessThanOrEqual(misure.destraBolla);
});
