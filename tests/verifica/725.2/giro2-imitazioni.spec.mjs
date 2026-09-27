// Verifica #725.2 giro 2: nel menu vero, l'elenco dei domini ufficiali tace sui
// siti legittimi, e il nome vero col trattino si vede anche sui servizi di
// hosting dove ognuno ha il suo sito (paypal-login.vercel.app).

import { test, expect } from '../../fixtures/electron.mjs';

async function avvisoSu(openTab, testServer, href) {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
    <p><a id="lnk" href="${href}">Verifica il tuo conto</a></p></body></html>`);
  await page.locator('#lnk').click({ button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
  return page;
}

for (const href of ['https://m.media-amazon.com/images/x.jpg', 'https://microsoft.sharepoint.com/sites/x', 'https://www.paypal-community.com/']) {
  test(`sito ufficiale senza avviso: ${href}`, async ({ openTab, testServer }) => {
    const page = await avvisoSu(openTab, testServer, href);
    await page.waitForTimeout(800);
    await expect(page.locator('.sn-menu .sn-menu-link-warn')).toHaveCount(0);
  });
}

for (const href of ['https://paypal-login.vercel.app/', 'https://secure-paypal.web.app/', 'https://paypal-secure.netlify.app/']) {
  test(`nome col trattino su un hosting: ${href}`, async ({ openTab, testServer }) => {
    const page = await avvisoSu(openTab, testServer, href);
    const avviso = page.locator('.sn-menu .sn-menu-link-warn');
    await expect(avviso).toBeVisible({ timeout: 3000 });
    expect(((await avviso.textContent()) || '')).toMatch(/paypal\.com.*imitazione/);
  });
}

test('nome davanti a un indirizzo numerico: l’avviso dice dove porta davvero', async ({ openTab, testServer }) => {
  const page = await avvisoSu(openTab, testServer, 'http://paypal.com@192.168.1.1/login');
  const avviso = page.locator('.sn-menu .sn-menu-link-warn');
  await expect(avviso).toBeVisible({ timeout: 3000 });
  expect(((await avviso.textContent()) || '')).toContain('192.168.1.1');
});
