// Verifica #725.2 giro 5, rilievo 1: «paypal.com@<indirizzo numerico>» si legge
// paypal.com ma porta a un computer qualsiasi; il menu lo nota solo quando dopo
// la chiocciola c'è un nome, non un numero (porta già vista al giro 2).

import { test, expect } from '../../fixtures/electron.mjs';

const pagina = (corpo) => `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">${corpo}</body></html>`;

async function avvisoSulLink(page, sel) {
  await page.locator(sel).click({ button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
  const avviso = page.locator('.sn-menu .sn-menu-link-warn');
  await expect(avviso).toBeVisible({ timeout: 3000 });
  return ((await avviso.textContent()) || '').trim();
}

test('paypal.com prima della chiocciola e un indirizzo numerico dopo: avviso col sito vero', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina(
    `<p><a id="ip" href="http://paypal.com@203.0.113.7/login">http://paypal.com/login</a></p>`));
  const testo = await avvisoSulLink(page, '#ip');
  expect(testo).toContain('paypal.com');
  expect(testo).toContain('203.0.113.7');
  expect(testo).toMatch(/imitazione/i);
});
