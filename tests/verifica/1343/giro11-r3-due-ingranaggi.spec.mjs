// Verifica #1343 giro 11, rilievo 3: nella barra laterale con «Altro…» aperto, «Opzioni Filo» e «Impostazioni» non
// hanno lo stesso disegno: fanno cose diverse a poche icone di distanza.

import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

test('r3 con «Altro…» aperto Opzioni Filo e Impostazioni hanno icone diverse', async ({ app }) => {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav [data-altro]').click();
  const opzioni = barra.locator('#nav .ico[data-id="openOptions"] svg');
  await expect(opzioni).toBeVisible();
  const a = await opzioni.innerHTML();
  const b = await barra.locator('[data-comando="settings"] svg').innerHTML();
  expect(a, 'due disegni diversi').not.toBe(b);
});
