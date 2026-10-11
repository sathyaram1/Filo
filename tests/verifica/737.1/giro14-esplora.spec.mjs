// #737.1 giro 14, esplorazione: il clic che porta altrove non è un gesto per la pagina d'arrivo né per quella che si lascia.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return [t.view.webContents.getURL(), t.view.webContents.getTitle()]; } catch (_) { return [t.url || '', '']; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter(([x]) => x.replace(/\?$/, '') === u).length;
const conTitolo = async (app, t) => (await schede(app)).filter(([, x]) => x === t).length;

test('la pagina raggiunta col clic nella stessa scheda non apre da sola la sua pubblicità', async ({ app, openTab, testServer }) => {
  const ad = testServer.html('<title>AD</title>');
  const b = testServer.html(`<title>ARRIVO</title><script>setTimeout(function(){window.open(${JSON.stringify(ad)})},300)</script>`);
  const page = await openTab(testServer.html(`<a id="l" href="${b}" style="font-size:40px">vai</a>`));
  await page.waitForTimeout(5600);
  await page.click('#l');
  await expect.poll(() => conTitolo(app, 'ARRIVO'), { timeout: 8000 }).toBe(1);
  await page.waitForTimeout(2500);
  expect(await aperteSu(app, ad)).toBe(0);
});

test('la pagina aperta col clic in una scheda nuova non apre da sola la sua pubblicità', async ({ app, openTab, testServer }) => {
  const ad = testServer.html('<title>AD</title>');
  const b = testServer.html(`<title>ARRIVO</title><script>setTimeout(function(){window.open(${JSON.stringify(ad)})},300)</script>`);
  const page = await openTab(testServer.html(`<a id="l" href="${b}" target="_blank" style="font-size:40px">vai</a>`));
  await page.waitForTimeout(5600);
  await page.click('#l');
  await expect.poll(() => conTitolo(app, 'ARRIVO'), { timeout: 8000 }).toBe(1);
  await page.waitForTimeout(2500);
  expect(await aperteSu(app, ad)).toBe(0);
});

for (const ev of ['beforeunload', 'pagehide', 'unload']) {
  test(`la pagina che si lascia col clic non apre una scheda in ${ev}`, async ({ app, openTab, testServer }) => {
    const ad = testServer.html('<title>AD</title>');
    const b = testServer.html('<title>ARRIVO</title>');
    const page = await openTab(testServer.html(`<a id="l" href="${b}" style="font-size:40px">vai</a>
      <script>addEventListener(${JSON.stringify(ev)},function(){window.open(${JSON.stringify(ad)})})</script>`));
    await page.waitForTimeout(5600);
    await page.click('#l');
    await expect.poll(() => conTitolo(app, 'ARRIVO'), { timeout: 8000 }).toBe(1);
    await page.waitForTimeout(2500);
    expect(await aperteSu(app, ad)).toBe(0);
  });
}

test('la pagina raggiunta col clic non va a schermo intero da sola', async ({ app, openTab, testServer }) => {
  const b = testServer.html(`<title>ARRIVO</title><script>setTimeout(function(){document.documentElement.requestFullscreen().then(function(){document.title='FS-SI'},function(){document.title='FS-NO'})},300)</script>`);
  const page = await openTab(testServer.html(`<a id="l" href="${b}" style="font-size:40px">vai</a>`));
  await page.waitForTimeout(5600);
  await page.click('#l');
  await expect.poll(async () => (await conTitolo(app, 'FS-SI')) + (await conTitolo(app, 'FS-NO')) * 10, { timeout: 8000 }).toBeGreaterThan(0);
  expect(await conTitolo(app, 'FS-SI')).toBe(0);
});
