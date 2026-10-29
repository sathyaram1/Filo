// Esplorazione #1767: sotto Trusted Types il tasto destro su un paragrafo senza selezione (il gesto più comune) apre
// il menu di Filo e «Invia feedback» apre il riquadro; le icone del menu, se ci sono, sono SVG vere.

import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Accedi</h1>
  <p id="paragraph">Usa il tuo account per continuare: una frase da selezionare e spiegare.</p>
  <a id="link" href="https://example.com/">un collegamento</a>
</body></html>`;
const CSP = "require-trusted-types-for 'script'; trusted-types 'none'";

test('tasto destro senza selezione sotto Trusted Types: menu di Filo e riquadro', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html(HTML, { headers: { 'Content-Security-Policy': CSP } }));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.locator('#paragraph').click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Invia feedback', { exact: true })).toBeVisible();
  const icone = await menu.locator('.sn-menu-item-icon').evaluateAll((ns) => ns.map((n) => n.querySelector('svg') ? 'svg' : 'vuota'));
  expect(icone.filter((x) => x === 'vuota')).toEqual([]);
  await page.screenshot({ path: 'tests/.shots/1767-tt-paragrafo.png' });
  await menu.getByText('Invia feedback', { exact: true }).click();
  await expect.poll(async () => (await statoDi(app, page, '.sn-fb-text'))?.visibile ?? false).toBe(true);
});

test('tasto destro su un collegamento sotto Trusted Types: le icone sono SVG vere', async ({ openTab, testServer }) => {
  const page = await openTab(testServer.html(HTML, { headers: { 'Content-Security-Policy': CSP } }));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.locator('#link').click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu).toBeVisible();
  const icone = await menu.locator('.sn-menu-item-icon').evaluateAll((ns) => ns.map((n) => n.querySelector('svg') ? 'svg' : 'vuota'));
  console.log('icone collegamento', icone.length, icone);
  expect(icone.filter((x) => x === 'vuota')).toEqual([]);
});
