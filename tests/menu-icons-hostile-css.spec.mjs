// Feedback alpha (magnific.com): il menu di Filo sta nel documento del sito, e una regola globale `svg { fill: red }`
// riempiva le nostre icone outline fino a renderle sagome. theme.css le riafferma con !important dentro i contenitori
// di Filo: l'icona di una voce del menu resta senza riempimento e col tratto del testo, non col rosso del sito.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

// Pagina "ostile": forza fill/stroke rossi su tutti gli svg, come fanno molti framework di icone.
const HOSTILE = `<!doctype html><html><head><style>
  svg { fill: #ff0000 !important; stroke: #ff0000 !important; }
  svg * { fill: #ff0000 !important; }
</style></head><body style="padding:40px;font:16px sans-serif">
  <h1>Sito ostile</h1>
  <p>Un testo da selezionare e leggere ad alta voce.</p>
</body></html>`;

test('le icone del menu restano outline anche se il sito forza svg{fill:red}', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HOSTILE);
  // Su una selezione il menu ha «Leggi ad alta voce», una voce con la sua icona.
  await page.locator('p').selectText();
  await page.locator('p').click({ button: 'right', position: { x: 20, y: 8 } });
  const menu = menuDi(page).locator('.sn-menu').first();
  await expect(menu).toBeVisible();

  const iconSvg = menu.locator('.sn-menu-item-icon svg').first();
  await expect(iconSvg).toBeVisible();

  const fill = await iconSvg.evaluate((el) => getComputedStyle(el).fill);
  // Senza il fix: "rgb(255, 0, 0)". Con il fix: "none".
  expect(fill).toBe('none');

  const stroke = await iconSvg.evaluate((el) => getComputedStyle(el).stroke);
  expect(stroke).not.toBe('rgb(255, 0, 0)');
});
