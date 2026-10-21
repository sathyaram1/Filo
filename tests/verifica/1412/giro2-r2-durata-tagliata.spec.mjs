// #1412 giro 2, rilievo 2: in Preferenze la tendina della durata della cache taglia la durata predefinita.

import { test, expect } from '../../fixtures/electron.mjs';

test('r2 la tendina della durata della cache mostra per intero la scelta predefinita', async ({ openTab }) => {
  test.setTimeout(90_000);
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForLoadState('domcontentloaded');
  const sel = pref.locator('#contestoCache');
  await sel.scrollIntoViewIfNeeded();
  await expect(pref.locator('#contestoCachePredefinita')).toHaveText(/un'ora/);
  const misura = await sel.evaluate((el) => {
    const c = document.createElement('canvas').getContext('2d');
    const cs = getComputedStyle(el);
    c.font = `${cs.fontSize} ${cs.fontFamily}`;
    const spazio = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { spazio, testo: c.measureText(el.options[el.selectedIndex].text).width };
  });
  expect(misura.testo, `«Come i predefiniti (un'ora)» chiede ${Math.round(misura.testo)} px, la tendina ne ha ${Math.round(misura.spazio)}`)
    .toBeLessThanOrEqual(misura.spazio);
});
