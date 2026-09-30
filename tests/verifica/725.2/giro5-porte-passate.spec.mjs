// Verifica #725.2 giro 5: le porte dei giri 1-3 ri-provate nel menu vero, chiuse
// su questo ramo. Deve restare verde.

import { test, expect } from '../../fixtures/electron.mjs';

const CON_AVVISO = [
  ['https://paypal.com.accesso-sicuro.net/login', 'accesso-sicuro.net'],
  ['https://paypal-com.net/', 'paypal-com.net'],
  ['https://paypal-login.vercel.app/', 'vercel.app'],
  ['https://paypal-login.github.io/', 'github.io'],
  ['https://secure-paypal.accesso-sicuro.net/', 'accesso-sicuro.net'],
  ['https://login-paypal.com.evil.net/', 'evil.net'],
  ['https://paypal-login.wixsite.com/', 'wixsite.com'],
  ['http://paypal.com@evil.com/', 'evil.com'],
];
const SENZA_AVVISO = [
  'https://www.paypal-community.com/',
  'https://m.media-amazon.com/images/x.jpg',
  'https://microsoft.sharepoint.com/',
  'https://google-research.github.io/',
  'https://instagram-engineering.com/',
  'https://apple.stackexchange.com/questions/1',
];

const tutti = [...CON_AVVISO.map(([h]) => h), ...SENZA_AVVISO];
const HTML = `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">${
  tutti.map((h, i) => `<p><a id="l${i}" href="${h}">collegamento ${i}</a></p>`).join('')}</body></html>`;

test('porte passate: le imitazioni hanno l\'avviso col sito vero, le pagine vere no', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  for (const [i, h] of tutti.entries()) {
    await page.locator(`#l${i}`).click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    const avviso = page.locator('.sn-menu .sn-menu-link-warn');
    if (i < CON_AVVISO.length) {
      await expect(avviso, h).toBeVisible({ timeout: 3000 });
      expect(((await avviso.textContent()) || ''), h).toContain(CON_AVVISO[i][1]);
    } else {
      await page.waitForTimeout(500);
      await expect(avviso, h).toHaveCount(0);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
  }
});
