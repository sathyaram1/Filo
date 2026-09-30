// #871 verifica giro 1, rilievo 2: il vuoto trasparente accanto alla barra aperta è della pagina
// (patterns/la-shell-non-disegna-sopra-la-pagina.md): rotella e clic che ci cadono arrivano al sito.

import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const SITO = `<!doctype html><html><body style="margin:0;height:4000px;font:16px sans-serif">
  <div id="z" style="position:fixed;left:0;top:0;width:240px;height:100%;background:#f3eee6">colonna del sito</div>
  <script>window.clic = 0; document.getElementById('z').addEventListener('click', () => window.clic++);</script>
</body></html>`;

function nelVuoto(app, eventi) {
  return app.evaluate(({ BrowserWindow }, ev) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const wc = w._filoTabs.barra.vista.webContents;
    for (const e of ev) wc.sendInputEvent(e);
  }, eventi);
}

test('barra aperta: la rotella e il clic nel margine dell\'ombra arrivano alla pagina', async ({ app, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  // Aperta da tastiera resta aperta col mouse sulla pagina: il margine resta dov'è per tutta la prova.
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  const s = await statoBarra(app);
  const x = s.bounds.width - 6;
  expect(x).toBeGreaterThan(56);

  await nelVuoto(app, [{ type: 'mouseMove', x, y: 300 }, { type: 'mouseWheel', x, y: 300, deltaX: 0, deltaY: -600 }]);
  await expect.poll(() => p.evaluate(() => window.scrollY), { timeout: 3000 }).toBeGreaterThan(0);

  await nelVuoto(app, [
    { type: 'mouseDown', x, y: 300, button: 'left', clickCount: 1 },
    { type: 'mouseUp', x, y: 300, button: 'left', clickCount: 1 },
  ]);
  await pausa(300);
  await expect.poll(() => p.evaluate(() => window.clic), { timeout: 3000 }).toBe(1);
});
