// Verifica #725.2 giro 5, rilievo 3: il nome famoso incollato a un'altra parola,
// con accanto una parola d'esca, passa senza avviso; e mancano esche frequenti.

import { test, expect } from '../../fixtures/electron.mjs';

const CASI = [
  ['https://login-microsoftonline.com/common/oauth2', 'microsoft.com'],
  ['https://microsoftonline-login.com/', 'microsoft.com'],
  ['https://amazonprime-rinnovo.com/', 'amazon'],
  ['https://instagram-copyright.com/appeal', 'instagram.com'],
  ['https://www-paypal.com/signin', 'paypal.com'],
];

const pagina = CASI.map(([href], i) => `<p><a id="l${i}" href="${href}">accedi</a></p>`).join('');
const HTML = `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">${pagina}</body></html>`;

for (const [i, [href, marchio]] of CASI.entries()) {
  test(`nome vero con un'esca: ${href}`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, HTML);
    await page.locator(`#l${i}`).click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    const avviso = page.locator('.sn-menu .sn-menu-link-warn');
    await expect(avviso).toBeVisible({ timeout: 3000 });
    const testo = ((await avviso.textContent()) || '').trim();
    expect(testo).toContain(marchio);
    expect(testo).toMatch(/imitazione/i);
  });
}
