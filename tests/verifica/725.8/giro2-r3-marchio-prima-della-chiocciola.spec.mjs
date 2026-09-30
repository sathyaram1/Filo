// Verifica #725.8 giro 2, rilievo 3: un indirizzo ufficiale scritto prima della chiocciola
// (https://www.paypal.com@altro-sito.net/) si legge come il sito vero, ma porta altrove: il menu tace.

import { test, expect } from '../../fixtures/electron.mjs';

const TRUCCHI = {
  'https://www.paypal.com@accesso-sicuro.net/login': 'PayPal',
  'https://www.poste.it:login@verifica-conto.net/': 'Poste Italiane',
};

test('un marchio prima della chiocciola ha l’avviso', async ({ openTab, testServer }) => {
  const url = Object.keys(TRUCCHI);
  const link = url.map((u, i) => `<p><a id="l${i}" href="${u}">Link ${i}</a></p>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">${link}</body></html>`);
  const muti = [];
  for (let i = 0; i < url.length; i++) {
    await page.locator('#l' + i).click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    const avviso = page.locator('.sn-menu .sn-menu-link-warn');
    try {
      await expect(avviso).toBeVisible({ timeout: 1500 });
      expect(((await avviso.textContent()) || '')).toContain(TRUCCHI[url[i]]);
    } catch (_) { muti.push(url[i]); }
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
  }
  expect(muti).toEqual([]);
});
