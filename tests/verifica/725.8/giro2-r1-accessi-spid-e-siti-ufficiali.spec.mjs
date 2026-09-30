// Verifica #725.8 giro 2, rilievo 1: le pagine d'accesso SPID dei gestori accreditati e altri indirizzi ufficiali
// dei marchi prendono l'avviso d'imitazione nel menu del link e all'apertura.

import { test, expect } from '../../fixtures/electron.mjs';

const VERI = [
  'https://spid.register.it/login/selfcare/login',
  'https://spid.intesigroup.com/',
  'https://loginspid.infocamere.it/',
  'https://github.blog/changelog/',
  'https://discordstatus.com/',
  'https://www.dhlparcel.nl/nl',
];

test('un link a una pagina d’accesso SPID o a un indirizzo ufficiale non si prende l’avviso', async ({ openTab, testServer }) => {
  const link = VERI.map((u, i) => `<p><a id="l${i}" href="${u}">Link ${i}</a></p>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">${link}</body></html>`);
  const conAvviso = [];
  for (let i = 0; i < VERI.length; i++) {
    await page.locator('#l' + i).click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    await page.waitForTimeout(400);
    if (await page.locator('.sn-menu .sn-menu-link-warn').count()) conAvviso.push(VERI[i]);
    if (i === 0) await page.screenshot({ path: 'tests/.shots/725-8-g2-spid.png' });
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
  }
  expect(conAvviso).toEqual([]);
});

test('all’apertura una pagina d’accesso SPID non chiede conferma come imitazione', async ({ app }) => {
  const livelli = await app.evaluate(() => {
    const SB = globalThis.SN_SAFEBROWSE;
    const out = {};
    for (const u of ['https://spid.register.it/login/selfcare/login', 'https://spid.intesigroup.com/', 'https://loginspid.infocamere.it/']) {
      out[u] = SB.checkSync(u, {}).level;
    }
    return out;
  });
  for (const [u, livello] of Object.entries(livelli)) expect(livello, u).toBe('safe');
});
