// Verifica #725.8 giro 2, rilievo 2: un rinvio che scrive la destinazione nel percorso (i collegamenti protetti
// di Proofpoint nelle mail aziendali) non viene letto, e il menu tace sull'imitazione a cui porta.

import { test, expect } from '../../fixtures/electron.mjs';

const RINVII = {
  'https://urldefense.com/v3/__https://poste.it.accesso-sicuro.net/login__;!!AbC123!xYz$': 'Poste Italiane',
  'https://urldefense.proofpoint.com/v2/url?u=https-3A__paypal.support_login&d=DwMFaQ&c=abc': 'PayPal',
};

test('un rinvio con la destinazione nel percorso ha l’avviso dell’imitazione', async ({ openTab, testServer }) => {
  const url = Object.keys(RINVII);
  const link = url.map((u, i) => `<p><a id="l${i}" href="${u}">Link ${i}</a></p>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">${link}</body></html>`);
  const muti = [];
  for (let i = 0; i < url.length; i++) {
    await page.locator('#l' + i).click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    const avviso = page.locator('.sn-menu .sn-menu-link-warn');
    try {
      await expect(avviso).toBeVisible({ timeout: 1500 });
      expect(((await avviso.textContent()) || '')).toContain(RINVII[url[i]]);
    } catch (_) { muti.push(url[i]); }
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
  }
  expect(muti).toEqual([]);
});
