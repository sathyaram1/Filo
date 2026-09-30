// Verifica #725.2 giro 5, rilievo 4: indirizzi che appartengono davvero
// all'azienda nominata (pagine aziendali su servizi riservati alle aziende, domini
// tecnici del marchio) ricevono «potrebbe essere un'imitazione».

import { test, expect } from '../../fixtures/electron.mjs';

const CASI = [
  'https://paypal.wd1.myworkdayjobs.com/jobs',
  'https://google.qualtrics.com/jfe/form/SV_prova',
  'https://youtube.googleapis.com/v/dQw4w9WgXcQ',
  'https://github.githubassets.com/assets/app.js',
];

const pagina = CASI.map((href, i) => `<p><a id="l${i}" href="${href}">collegamento</a></p>`).join('');
const HTML = `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">${pagina}</body></html>`;

for (const [i, href] of CASI.entries()) {
  test(`indirizzo dell'azienda stessa, nessun avviso: ${href}`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, HTML);
    await page.locator(`#l${i}`).click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.locator('.sn-menu .sn-menu-link-warn')).toHaveCount(0);
  });
}
