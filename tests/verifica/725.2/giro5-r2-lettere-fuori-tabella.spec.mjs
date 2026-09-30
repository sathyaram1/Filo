// Verifica #725.2 giro 5, rilievo 2: un nome famoso scritto con una lettera
// sosia che la tabella delle lettere simili non conosce (ı senza puntino, alfa
// latina, cirillica ԍ) non riceve l'avviso; il controllo di navigazione sì.

import { test, expect } from '../../fixtures/electron.mjs';

const CASI = [
  ['https://mıcrosoft.com/login', 'microsoft.com'],
  ['https://ɑmazon.com/', 'amazon'],
  ['https://ԍithub.com/login', 'github.com'],
];

const pagina = CASI.map(([href], i) => `<p><a id="l${i}" href="${href}">accedi</a></p>`).join('');
const HTML = `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">${pagina}</body></html>`;

for (const [i, [href, marchio]] of CASI.entries()) {
  test(`lettera sosia fuori tabella: ${href}`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, HTML);
    await page.locator(`#l${i}`).click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    const avviso = page.locator('.sn-menu .sn-menu-link-warn');
    await expect(avviso).toBeVisible({ timeout: 3000 });
    const testo = ((await avviso.textContent()) || '').trim();
    expect(testo).toContain(marchio);
    expect(testo).toMatch(/imitazione/i);
  });
}
