// Verifica #725.8 giro 5, rilievo 1: il sito di Postepay (indicato da Poste come suo) e BPerfect Cosmetics, un marchio
// di trucchi col nome che comincia come BPER, non si prendono l'avviso d'imitazione nel menu; BPerfect nemmeno all'apertura.

import { test, expect } from '../../fixtures/electron.mjs';

const VERI = ['https://www.postepay.it/', 'https://bperfectcosmetics.com/'];

test('r1 nel menu il sito di Postepay e quello di BPerfect non hanno l’avviso', async ({ openTab, testServer }) => {
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

test('r1 all’apertura BPerfect Cosmetics è pulito', async ({ app }) => {
  const livello = await app.evaluate((_, u) => globalThis.SN_SAFEBROWSE.checkSync(u, {}).level, 'https://bperfectcosmetics.com/');
  expect(livello).toBe('safe');
});
