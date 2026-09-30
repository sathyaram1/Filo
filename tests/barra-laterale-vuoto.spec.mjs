// #871 — il vuoto trasparente accanto alla barra aperta (l'ombra, le fasce sopra e sotto il pannello) è della
// pagina: clic, doppio clic, tasto destro e rotella che ci cadono arrivano al sito, e il clic chiude la barra.
// Regole: patterns/la-shell-non-disegna-sopra-la-pagina.md

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from './helpers/barra.mjs';

const SITO = `<!doctype html><html><body style="margin:0;height:4000px;font:16px sans-serif">
  <div id="z" style="position:fixed;left:0;top:0;width:240px;height:100%;background:#f3eee6">colonna del sito</div>
  <script>
    window.gesti = { clic: 0, doppio: 0 };
    const z = document.getElementById('z');
    z.addEventListener('click', () => window.gesti.clic++);
    z.addEventListener('dblclick', () => window.gesti.doppio++);
  </script>
</body></html>`;

function nelVuoto(app, eventi) {
  return app.evaluate(({ BrowserWindow }, ev) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const wc = w._filoTabs.barra.vista.webContents;
    for (const e of ev) wc.sendInputEvent(e);
  }, eventi);
}
const clic = (x, y, button = 'left', clickCount = 1) => [
  { type: 'mouseDown', x, y, button, clickCount },
  { type: 'mouseUp', x, y, button, clickCount },
];

test('barra aperta: rotella, tasto destro, doppio clic e clic nel margine dell\'ombra arrivano alla pagina', async ({ app, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  // Aperta da tastiera resta aperta col mouse sulla pagina: il margine resta dov'è.
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  const s = await statoBarra(app);
  const x = s.bounds.width - 6;
  expect(x).toBeGreaterThan(56);

  await nelVuoto(app, [{ type: 'mouseMove', x, y: 300 }, { type: 'mouseWheel', x, y: 300, deltaX: 0, deltaY: -600 }]);
  await expect.poll(() => p.evaluate(() => window.scrollY), { timeout: 3000 }).toBeGreaterThan(0);

  // Il tasto destro nel vuoto è quello della pagina: si apre il menu di Filo sulla pagina.
  await nelVuoto(app, clic(x, 300, 'right'));
  await expect(p.locator('.sn-menu')).toBeVisible({ timeout: 5000 });
  await comandaBarra(app, 'chiudi');
  await p.keyboard.press('Escape');
  await expect(p.locator('.sn-menu')).toBeHidden();
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);

  await nelVuoto(app, [...clic(x, 320), ...clic(x, 320, 'left', 2)]);
  await expect.poll(() => p.evaluate(() => window.gesti.doppio), { timeout: 3000 }).toBe(1);
  expect(await p.evaluate(() => window.gesti.clic)).toBeGreaterThanOrEqual(1);
  // Il clic arrivato alla pagina chiude la barra, come ogni clic sulla pagina.
  await expect.poll(async () => (await statoBarra(app)).aperta, { timeout: 3000 }).toBe(false);
});

test('la fascia sotto il pannello è della pagina, il pannello no', async ({ app, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  const s = await statoBarra(app);
  // Sul pannello (fra le icone) la rotella resta della barra.
  await nelVuoto(app, [{ type: 'mouseMove', x: 28, y: 200 }, { type: 'mouseWheel', x: 28, y: 200, deltaX: 0, deltaY: -600 }]);
  await p.waitForTimeout(400);
  expect(await p.evaluate(() => window.scrollY)).toBe(0);
  // Sotto il pannello, a filo del fondo della finestra: della pagina.
  const y = s.bounds.height - 3;
  await nelVuoto(app, [{ type: 'mouseMove', x: 20, y }, { type: 'mouseWheel', x: 20, y, deltaX: 0, deltaY: -600 }]);
  await expect.poll(() => p.evaluate(() => window.scrollY), { timeout: 3000 }).toBeGreaterThan(0);
});
