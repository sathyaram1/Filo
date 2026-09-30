// Verifica #725.8 giro 1, rilievo 1: col giudizio del motore il menu del link grida al lupo su siti veri
// (indirizzi ufficiali dei marchi, parole comuni vicine a un marchio), e all'apertura lo stesso giudizio blocca.

import { test, expect } from '../../fixtures/electron.mjs';

// Siti veri che su main il menu lasciava puliti.
const VERI = [
  'https://www.telegraph.co.uk/news/',
  'https://www.cloud.it/',
  'https://revolut.me/mario',
  'https://apple.co/3abcdEf',
  'https://telegram.me/filo',
  'https://cdn.discordapp.com/attachments/1/2/foto.png',
  'https://www.aboutamazon.it/',
  'https://www.postemobile.it/',
  'https://www.nexigroup.com/',
  'https://www.imposte.it/',
];

test('un link a un sito vero non si prende l’avviso d’imitazione', async ({ openTab, testServer }) => {
  const link = VERI.map((u, i) => `<p><a id="l${i}" href="${u}">Link ${i}</a></p>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">${link}</body></html>`);
  const conAvviso = [];
  for (let i = 0; i < VERI.length; i++) {
    await page.locator('#l' + i).click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    await page.waitForTimeout(400);
    if (await page.locator('.sn-menu .sn-menu-link-warn').count()) conAvviso.push(VERI[i]);
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
  }
  expect(conAvviso).toEqual([]);
});

test('all’apertura un sito vero non viene bloccato come imitazione', async ({ app }) => {
  const livelli = await app.evaluate(() => {
    const SB = globalThis.SN_SAFEBROWSE;
    const out = {};
    for (const u of ['https://www.telegraph.co.uk/', 'https://www.cloud.it/', 'https://telegra.ph/pagina', 'https://revolut.me/mario']) {
      out[u] = SB.checkSync(u, {}).level;
    }
    return out;
  });
  for (const [u, livello] of Object.entries(livelli)) expect(livello, u).toBe('safe');
});
