// #1122 — Su una pagina che impone Trusted Types (accounts.google.com, Gmail, YouTube…) il tasto destro
// deve aprire il menu di Filo con le sue voci, anche quando la pagina limita i nomi delle policy.

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Accedi</h1>
  <p id="paragraph">Usa il tuo account per continuare: una frase da selezionare e spiegare.</p>
  <input id="email" type="email" placeholder="Email o telefono" style="width:300px">
</body></html>`;

const CSP = {
  'solo obbligo': "require-trusted-types-for 'script'",
  'nessun nome ammesso': "require-trusted-types-for 'script'; trusted-types 'none'",
  'solo i nomi della pagina': "require-trusted-types-for 'script'; trusted-types goog#html",
};

for (const [caso, csp] of Object.entries(CSP)) {
  test(`Trusted Types (${caso}): il tasto destro apre il menu di Filo con le sue voci`, async ({ openTab, testServer }) => {
    const page = await openTab(testServer.html(HTML, { headers: { 'Content-Security-Policy': csp } }));
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    // La pagina impone davvero Trusted Types: un innerHTML del sito stesso viene rifiutato.
    expect(await page.evaluate(() => { try { document.body.insertAdjacentHTML('beforeend', '<b></b>'); return 'passato'; } catch (e) { return 'rifiutato'; } })).toBe('rifiutato');

    await page.locator('#paragraph').click({ button: 'right' });
    const menu = page.locator('.sn-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Invia feedback', { exact: true })).toBeVisible();
    // Le icone sono SVG costruite da stringa: devono esserci davvero, non riquadri vuoti.
    expect(await menu.locator('svg').count()).toBeGreaterThan(3);
  });
}
