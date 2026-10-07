// Feedback alpha (T39w1JXHbPELmlt54FYF): "su questo sito (magnific.com) le icone
// sono rotte". Causa: il menu Filo è iniettato nel DOM della pagina ospite, e
// molti siti impostano regole globali tipo `svg { fill: currentColor }`. Le
// nostre icone sono outline (fill="none"): la regola del sito sovrascrive
// l'attributo fill e le riempie di colore pieno → diventano sagome illeggibili.
//
// Il fix riasserisce i default delle icone DENTRO i contenitori Filo con
// !important (theme.css). Questo test riproduce un sito ostile e asserisce il
// COMPORTAMENTO: le icone outline del menu restano NON riempite (fill: none)
// anche quando la pagina forza `svg { fill: red }`. Senza il fix, la fill
// computata sarebbe rossa → test rosso.

import { test, expect } from './fixtures/electron.mjs';

// Pagina "ostile": forza fill/stroke rossi su tutti gli svg, come fanno molti
// framework di icone. Simula la condizione di magnific.com.
const HOSTILE = `<!doctype html><html><head><style>
  svg { fill: #ff0000 !important; stroke: #ff0000 !important; }
  svg * { fill: #ff0000 !important; }
</style></head><body style="padding:40px;font:16px sans-serif">
  <h1>Sito ostile</h1>
  <p>Click destro per il menu Filo.</p>
</body></html>`;

test('le icone del menu restano outline anche se il sito forza svg{fill:red}', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HOSTILE);
  await page.locator('p').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();

  // Prendo un'icona outline del menu (un bottone della riga icone con SVG).
  const iconSvg = menu.locator('.sn-menu-row-btn svg').first();
  await expect(iconSvg).toBeVisible();

  const fill = await iconSvg.evaluate((el) => getComputedStyle(el).fill);
  // Senza il fix: "rgb(255, 0, 0)". Con il fix: "none".
  expect(fill).toBe('none');

  const stroke = await iconSvg.evaluate((el) => getComputedStyle(el).stroke);
  // Deve restare currentColor (NON il rosso forzato dal sito).
  expect(stroke).not.toBe('rgb(255, 0, 0)');
});

test('i puntini pieni (fill=currentColor) di un\'icona restano pieni', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HOSTILE);
  await page.locator('p').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();

  // Cerco un elemento interno con fill="currentColor" (es. i puntini dell'icona
  // App). Deve restare riempito col colore del testo, NON azzerato dal fix né
  // rosso dal sito.
  const dot = menu.locator('svg [fill="currentColor"]').first();
  const count = await menu.locator('svg [fill="currentColor"]').count();
  if (count === 0) test.skip(true, 'nessuna icona con riempimenti espliciti nella riga corrente');
  const dotFill = await dot.evaluate((el) => getComputedStyle(el).fill);
  expect(dotFill).not.toBe('none');
  expect(dotFill).not.toBe('rgb(255, 0, 0)');
});

// #586: dentro un dialogo modale il menu nasce nel dialogo, e lo stile del testo del sito non deve arrivare alle voci.
test('nato in un dialogo modale col testo centrato e maiuscolo, il menu ha le voci di sempre', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>Dialogo</title><body>
    <dialog id="d" style="padding:20px;width:360px;text-align:center;text-transform:uppercase;letter-spacing:3px;word-spacing:9px;font-style:italic;font-weight:700">
    <p>Accedi</p><input id="c" style="width:300px"></dialog><script>d.showModal()</script></body>`);
  const box = await page.locator('#c').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  const voce = page.locator('#d .sn-menu .sn-menu-paste-main .sn-menu-label').first();
  await expect(voce).toBeVisible({ timeout: 5000 });
  const st = await voce.evaluate((el) => {
    const c = getComputedStyle(el);
    return { textAlign: c.textAlign, textTransform: c.textTransform, letterSpacing: c.letterSpacing, wordSpacing: c.wordSpacing, fontStyle: c.fontStyle, fontWeight: c.fontWeight };
  });
  expect(st).toEqual({ textAlign: 'start', textTransform: 'none', letterSpacing: 'normal', wordSpacing: '0px', fontStyle: 'normal', fontWeight: '400' });
});
