// Verifica #725.8 giro 4, rilievo 1: siti veri che portano il nome di un marchio dell'elenco (La Poste francese,
// le sedi nazionali di GLS e DHL) non si prendono l'avviso d'imitazione, né nel menu né all'apertura.

import { test, expect } from '../../fixtures/electron.mjs';

const VERI = [
  'https://www.laposte.fr/', // La Poste, il servizio postale francese
  'https://www.laposte.net/', // la posta elettronica di La Poste
  'https://gls-poland.com/', // GLS Polonia
  'https://www.gls-info.nl/', // GLS Paesi Bassi
  'https://www.dhlecommerce.co.uk/', // DHL eCommerce nel Regno Unito
];

test('r1 nel menu i siti veri col nome di un marchio non hanno l’avviso', async ({ openTab, testServer }) => {
  const link = VERI.map((u, i) => `<p><a id="v${i}" href="${u}">Link ${i}</a></p>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">${link}</body></html>`);
  const conAvviso = [];
  for (let i = 0; i < VERI.length; i++) {
    await page.locator('#v' + i).click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    await page.waitForTimeout(400);
    const avviso = page.locator('.sn-menu .sn-menu-link-warn');
    if (await avviso.count()) conAvviso.push(`${VERI[i]} → ${((await avviso.textContent()) || '').trim()}`);
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
  }
  expect(conAvviso).toEqual([]);
});

test('r1 all’apertura i siti veri col nome di un marchio sono puliti', async ({ app }) => {
  const sospetti = await app.evaluate((_, veri) => {
    const SB = globalThis.SN_SAFEBROWSE;
    return veri.map((u) => `${u} → ${SB.checkSync(u, {}).level}`).filter((r) => !r.endsWith('→ safe'));
  }, VERI);
  expect(sospetti).toEqual([]);
});
