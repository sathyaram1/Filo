// Verifica #737.1 giro 3, rilievo 1: un riquadro di un altro sito non riceve il gesto dato alla pagina che lo ospita.
import { test, expect } from '../../fixtures/electron.mjs';

const aperteSu = (app, u) => app.evaluate(({ BrowserWindow }, x) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.filter((t) => { try { return t.view.webContents.getURL().replace(/\?$/, '') === x; } catch (_) { return false; } }).length;
}, u);

test('un clic sul testo dell\'articolo non lascia aprire una scheda al riquadro pubblicitario di un altro sito', async ({ app, openTab, testServer }) => {
  const bersaglio = testServer.html('<title>PUBBLICITA</title>');
  const ad = testServer.html(`<p>ad</p><script>setInterval(function(){window.open(${JSON.stringify(bersaglio)})},300)</script>`, { pubblico: true });
  const page = await openTab(testServer.html(`<title>Articolo</title><p style="height:200px">testo da leggere</p><iframe src="${ad}" width="300" height="100"></iframe>`));
  await expect.poll(() => page.frames().some((f) => f.url() === ad), { timeout: 8000 }).toBe(true);
  await page.waitForTimeout(1500);
  expect(await aperteSu(app, bersaglio)).toBe(0);
  await page.mouse.click(50, 50);
  await page.waitForTimeout(2000);
  expect(await aperteSu(app, bersaglio), 'il riquadro non ha avuto clic').toBe(0);
});
