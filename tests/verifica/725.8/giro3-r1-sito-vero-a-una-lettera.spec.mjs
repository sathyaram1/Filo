// Verifica #725.8 giro 3, rilievo 1: un sito vero e noto il cui nome dista una lettera da un marchio entrato
// con questo lavoro (Aruba, Banco BPM, Isybank) viene preso per un falso: avviso nel menu e blocco all'apertura.

import { test, expect } from '../../fixtures/electron.mjs';

const VERI = [
  'https://service.ariba.com/Supplier.aw', // SAP Ariba, il portale fornitori
  'https://supplier.ariba.com/',
  'https://www.isbank.com.tr/', // Türkiye İş Bankası
  'https://www.bancobpi.pt/', // Banco BPI
  // Le immagini condivise dalla comunità di Steam: il nome attaccato ad altre parole in un sottodominio della rete di Akamai.
  'https://steamuserimages-a.akamaihd.net/ugc/1234567890/ABCDEF0123456789/',
];

test('nel menu un sito vero a una lettera da un marchio non si prende l’avviso', async ({ openTab, testServer }) => {
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

test('all’apertura un sito vero a una lettera da un marchio non viene bloccato', async ({ app }) => {
  const livelli = await app.evaluate((_, urls) => {
    const SB = globalThis.SN_SAFEBROWSE;
    return urls.map((u) => `${u} → ${SB.checkSync(u, {}).level}`);
  }, VERI);
  expect(livelli.filter((r) => !r.endsWith('→ safe'))).toEqual([]);
});
