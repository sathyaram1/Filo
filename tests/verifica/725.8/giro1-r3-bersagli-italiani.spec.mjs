// Verifica #725.8 giro 1, rilievo 3: l'elenco unico dei marchi non conosce altri bersagli frequenti del phishing
// in italiano (enti pubblici, altre banche, hosting): né il menu del link né l'apertura dicono niente.

import { test, expect } from '../../fixtures/electron.mjs';

const IMITAZIONI = [
  'https://inps-rimborso.com/',
  'https://agenziaentrate-rimborsi.com/',
  'https://aruba-rinnovo.com/',
  'https://bper-sicurezza.com/',
  'https://mediolanum-accesso.com/',
];

test('le imitazioni dei bersagli italiani più comuni hanno l’avviso', async ({ openTab, testServer }) => {
  const link = IMITAZIONI.map((u, i) => `<p><a id="l${i}" href="${u}">Link ${i}</a></p>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">${link}</body></html>`);
  const muti = [];
  for (let i = 0; i < IMITAZIONI.length; i++) {
    await page.locator('#l' + i).click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    try { await expect(page.locator('.sn-menu .sn-menu-link-warn')).toBeVisible({ timeout: 1500 }); } catch (_) { muti.push(IMITAZIONI[i]); }
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
  }
  expect(muti).toEqual([]);
});
