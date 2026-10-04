// #737.1 giro 4, rilievo 1: un riquadro pubblicitario di un altro sito che nasconde il referrer usa il clic e i tasti
// dati all'articolo per aprire schede.
import { test, expect } from '../../fixtures/electron.mjs';

const aperteSu = (app, u) => app.evaluate(({ BrowserWindow }, x) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.filter((t) => { try { return t.view.webContents.getURL().replace(/\?$/, '') === x; } catch (_) { return false; } }).length;
}, u);

for (const [nome, testa, apri] of [
  ['con noreferrer fra le misure', '', "window.open(u,'_blank','noopener,noreferrer')"],
  ['con la regola no-referrer della pagina', '<meta name="referrer" content="no-referrer">', 'window.open(u)'],
]) {
  test(`il clic e i tasti sull'articolo non valgono per il riquadro pubblicitario (${nome})`, async ({ app, openTab, testServer }) => {
    const bersaglio = testServer.html('<title>PUBBLICITA</title>');
    const ad = testServer.html(`${testa}<p>ad</p><script>var u=${JSON.stringify(bersaglio)};setInterval(function(){${apri}},300)</script>`, { pubblico: true });
    const page = await openTab(testServer.html(`<title>Articolo</title><p style="height:200px">testo da leggere</p><input id="q"><iframe src="${ad}" width="300" height="100"></iframe>`));
    await expect.poll(() => page.frames().some((f) => f.url() === ad), { timeout: 8000 }).toBe(true);
    await page.waitForTimeout(1000);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(1200);
    await page.click('#q');
    await page.keyboard.type('ciao', { delay: 300 });
    await page.waitForTimeout(1500);
    expect(await aperteSu(app, bersaglio)).toBe(0);
  });
}
