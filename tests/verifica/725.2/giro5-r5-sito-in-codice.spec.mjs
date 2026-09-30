// Verifica #725.2 giro 5, rilievo 5: quando il sito che comanda ha lettere di
// un altro alfabeto, l'avviso lo nomina col codice interno «xn--…», che chi
// legge non ritrova nell'indirizzo che vede.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
  <p><a id="l0" href="https://secure-раураl.com/">secure-paypal.com</a></p></body></html>`;

test('l\'avviso nomina il sito come si legge, non col codice xn--', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('#l0').click({ button: 'right' });
  const avviso = page.locator('.sn-menu .sn-menu-link-warn');
  await expect(avviso).toBeVisible({ timeout: 3000 });
  const testo = ((await avviso.textContent()) || '').trim();
  expect(testo).toContain('paypal.com');
  expect(testo).not.toMatch(/xn--/);
});
