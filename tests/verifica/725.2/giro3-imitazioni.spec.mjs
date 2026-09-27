// Verifica #725.2 giro 3: il nome vero legato col trattino in un pezzo davanti al
// sito che comanda deve avere l'avviso; le pagine ufficiali dei marchi no.

import { test, expect } from '../../fixtures/electron.mjs';

async function avvisoSu(openTab, testServer, href) {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
    <p><a id="lnk" href="${href}">Verifica il tuo conto</a></p></body></html>`);
  await page.locator('#lnk').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.waitForTimeout(300);
  const n = await page.locator('.sn-menu .sn-menu-link-warn').count();
  await page.keyboard.press('Escape');
  return n > 0;
}

const IMITAZIONI = [
  'https://paypal-login.evil.com/',
  'https://secure-paypal.accesso-sicuro.net/',
  'https://login-paypal.com.evil.net/',
  'https://paypal-login.wixsite.com/conto',
  'https://paypal-login.weebly.com/',
  'https://paypal-login.000webhostapp.com/',
];

for (const href of IMITAZIONI) {
  test(`giro 3: ${href} ha l'avviso`, async ({ openTab, testServer }) => {
    expect(await avvisoSu(openTab, testServer, href)).toBe(true);
  });
}

const UFFICIALI = [
  'https://google-research.github.io/',
  'https://amazon-science.github.io/',
  'https://google-developers.appspot.com/',
];

for (const href of UFFICIALI) {
  test(`giro 3: ${href} non ha l'avviso`, async ({ openTab, testServer }) => {
    expect(await avvisoSu(openTab, testServer, href)).toBe(false);
  });
}
