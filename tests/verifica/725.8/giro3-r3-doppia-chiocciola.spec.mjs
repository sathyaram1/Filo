// Verifica #725.8 giro 3, rilievo 3: l'indirizzo ufficiale prima della chiocciola sfugge all'avviso se dopo di lui
// c'è una seconda chiocciola scritta in codice (%40): il link si legge ancora come il sito vero.

import { test, expect } from '../../fixtures/electron.mjs';

const TRUCCHI = {
  'https://www.poste.it%40verifica-conto.net@accesso-sicuro.net/': 'Poste Italiane',
  'https://www.paypal.com%40conto.net@accesso-sicuro.net/login': 'PayPal',
};

test('un marchio prima di due chiocciole ha l’avviso', async ({ openTab, testServer }) => {
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
