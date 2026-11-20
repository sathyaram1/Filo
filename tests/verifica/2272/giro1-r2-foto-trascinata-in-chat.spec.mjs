// Verifica #2272 giro 1, rilievo 2: una foto della risposta trascinata col mouse nel campo della chat.

import { test, expect } from '../../fixtures/electron.mjs';
import * as Gesti from '../../helpers/gestiVeri.mjs';
import { NEWTAB, preparaImmagini, stubModello, chiedi } from './aiuti.mjs';

test('r2 trascinata nel campo della chat, una foto della risposta diventa un allegato, non un indirizzo interno', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  test.skip(!Gesti.disponibili(), 'servono i gesti veri del sistema (schermo virtuale con XTest)');
  await preparaImmagini(app, 3);
  await stubModello(app, [
    { strumento: { azione: 'immagini', query: 'antilope' } },
    { testo: 'Ecco le antilopi.\n\n[[immagini: $ID0, $ID1, $ID2]]' },
  ]);
  const page = await openTab(NEWTAB);
  await Gesti.finestraASchermo(app);
  await chiedi(page, 'antilope immagine');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Ecco le antilopi.' });
  await expect(bolla).toBeVisible({ timeout: 30_000 });
  const img = bolla.locator('.filo-galleria-img').first();
  await expect.poll(() => img.evaluate((e) => e.complete && e.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
  const da = await Gesti.sulloSchermo(app, page, page, '.dash-bubble-filo .filo-galleria-img');
  const a = await Gesti.sulloSchermo(app, page, page, '#input');
  Gesti.trascina(da, { x: da.x + 30, y: da.y + 20 }, a);
  await expect(page.locator('#input')).not.toHaveValue(/filo:\/\/icone/, { timeout: 5_000 });
  await expect(page.locator('#imgPreviews img')).toHaveCount(1, { timeout: 5_000 });
});
