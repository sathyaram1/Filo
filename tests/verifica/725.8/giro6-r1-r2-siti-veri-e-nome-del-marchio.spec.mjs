// Verifica #725.8 giro 6. r1: indirizzi ufficiali che l'elenco non conosce, e siti veri di altri col nome di un
// marchio, prendono nel menu l'avviso d'imitazione (su main il menu li lasciava puliti). r2: l'avviso nomina il marchio
// sbagliato per Google, Apple e Microsoft.

import { test, expect } from '../../fixtures/electron.mjs';

const VERI = [
  // Indirizzi ufficiali dei marchi
  'https://netflix.shop/',
  'https://stripe.press/',
  'https://dropbox.tech/',
  'https://www.dropboxforum.com/',
  'https://www.google.com.hk/',
  'https://www.apple.com.cn/',
  'https://www.amazon.co.za/',
  'https://www.chase.co.uk/',
  'https://www.microsofttranslator.com/',
  'https://www.unicreditbank.sk/',
  'https://www.dhlparcel.pl/',
  // Siti veri di altri che portano lo stesso nome
  'https://www.poste.tn/',
  'https://www.poste.dz/',
  'https://www.arubabank.com/',
  'https://www.arubaairlines.com/',
  'https://amazonwatch.org/',
  'https://www.gls-sprachen.de/',
];

async function avvisiDelMenu(openTab, testServer, urls) {
  const link = urls.map((u, i) => `<p><a id="v${i}" href="${u}">Link ${i}</a></p>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">${link}</body></html>`);
  const out = [];
  for (let i = 0; i < urls.length; i++) {
    await page.locator('#v' + i).scrollIntoViewIfNeeded();
    await page.locator('#v' + i).click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    await page.waitForTimeout(400);
    const avviso = page.locator('.sn-menu .sn-menu-link-warn');
    out.push((await avviso.count()) ? ((await avviso.textContent()) || '').trim() : '');
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
  }
  return out;
}

test('r1 nel menu i siti veri non si prendono l’avviso d’imitazione', async ({ openTab, testServer }) => {
  const avvisi = await avvisiDelMenu(openTab, testServer, VERI);
  expect(VERI.map((u, i) => (avvisi[i] ? `${u} → ${avvisi[i]}` : '')).filter(Boolean)).toEqual([]);
});

test('r2 l’avviso nomina il marchio imitato, non un suo prodotto', async ({ openTab, testServer }) => {
  const casi = [
    ['https://google-login.xyz/', 'Google (google.com)'],
    ['https://appleid-verify.com/', 'Apple (apple.com)'],
    ['https://microsoft-login.xyz/', 'Microsoft (microsoft.com)'],
  ];
  const avvisi = await avvisiDelMenu(openTab, testServer, casi.map(([u]) => u));
  expect(casi.map(([u, atteso], i) => (avvisi[i].includes(atteso) ? '' : `${u} → ${avvisi[i]}`)).filter(Boolean)).toEqual([]);
});
