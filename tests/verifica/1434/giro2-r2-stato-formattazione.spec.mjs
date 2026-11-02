// Verifica #1434 giro 2, rilievo 2: sul testo già in grassetto l'icona Grassetto della fila si mostra accesa, così chi
// la preme sa che lo toglierà; quella del Corsivo, non applicato, no.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SITO = `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <div id="ricco" contenteditable="true" style="border:1px solid #999;padding:6px;width:400px">Una <b>parola</b> da formattare.</div>
  </body></html>`;

const stato = (b) => b.evaluate((e) => `${e.getAttribute('aria-pressed') || ''}|${[...e.classList].sort().join(' ')}`);

test('r2 sul testo in grassetto l\'icona Grassetto della fila è accesa e il Corsivo no', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const p = await page.evaluate(() => {
    const el = document.getElementById('ricco');
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el.querySelector('b'));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const menu = menuDi(page);
  const grassetto = menu.locator('.sn-menu-row [data-sn-icon-id="scrivibile:bold"]');
  const corsivo = menu.locator('.sn-menu-row [data-sn-icon-id="scrivibile:italic"]');
  await expect(grassetto).toBeVisible();
  const [g, c] = [await stato(grassetto), await stato(corsivo)];
  expect(g, `grassetto «${g}», corsivo «${c}»`).not.toBe(c);
});
