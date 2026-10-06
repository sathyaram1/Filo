// Verifica #725.8 giro 3, rilievo 1, riscritta sulla decisione dell'owner: un sito vero a una lettera da un marchio
// entrato con questo lavoro prende al più l'avviso che si chiude, mai il blocco; le reti di Steam sono sue.

import { test, expect } from '../../fixtures/electron.mjs';

const VICINI = [
  'https://service.ariba.com/Supplier.aw', // SAP Ariba, il portale fornitori
  'https://supplier.ariba.com/',
  'https://www.isbank.com.tr/', // Türkiye İş Bankası
  'https://www.bancobpi.pt/', // Banco BPI
];
// Le immagini condivise dalla comunità di Steam: il nome attaccato ad altre parole in un sottodominio della rete di Akamai.
const STEAM = [
  'https://steamuserimages-a.akamaihd.net/ugc/1234567890/ABCDEF0123456789/',
  'https://steamcdn-a.akamaihd.net/apps/570/header.jpg',
];

test('nel menu le immagini di Steam non si prendono l’avviso', async ({ openTab, testServer }) => {
  const link = STEAM.map((u, i) => `<p><a id="v${i}" href="${u}">Link ${i}</a></p>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">${link}</body></html>`);
  const conAvviso = [];
  for (let i = 0; i < STEAM.length; i++) {
    await page.locator('#v' + i).click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    await page.waitForTimeout(400);
    const avviso = page.locator('.sn-menu .sn-menu-link-warn');
    if (await avviso.count()) conAvviso.push(`${STEAM[i]} → ${((await avviso.textContent()) || '').trim()}`);
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
  }
  expect(conAvviso).toEqual([]);
});

test('all’apertura un sito vero a una lettera da un marchio non viene bloccato, e Steam è pulito', async ({ app }) => {
  const livelli = await app.evaluate((_, { vicini, steam }) => {
    const SB = globalThis.SN_SAFEBROWSE;
    return {
      bloccati: vicini.map((u) => `${u} → ${SB.checkSync(u, {}).level}`).filter((r) => r.endsWith('→ pericoloso')),
      steam: steam.map((u) => `${u} → ${SB.checkSync(u, {}).level}`).filter((r) => !r.endsWith('→ safe')),
    };
  }, { vicini: VICINI, steam: STEAM });
  expect(livelli).toEqual({ bloccati: [], steam: [] });
});
