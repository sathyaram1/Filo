import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter((x) => x.replace(/\?$/, '') === u).length;

test('A muovere e scorrere sulla pagina non è un gesto', async ({ app, openTab, testServer }) => {
  const b = testServer.html('<title>DA SOLA</title>');
  const page = await openTab(testServer.html(`<div style="height:3000px">lungo</div><script>setInterval(function(){window.open(${JSON.stringify(b)})},300)</script>`));
  await page.waitForTimeout(1000);
  for (let i = 0; i < 10; i++) { await page.mouse.move(50 + i * 20, 80 + i * 10); await page.mouse.wheel(0, 120); await page.waitForTimeout(100); }
  await page.waitForTimeout(1500);
  console.log('A aperte', await aperteSu(app, b));
});

test('E clic su un link che porta a un sito che apre da solo al caricamento', async ({ app, openTab, testServer }) => {
  const b = testServer.html('<title>DA SOLA</title>');
  const dest = testServer.html(`<title>Dest</title><script>window.open(${JSON.stringify(b)})</script>`, { pubblico: true });
  const dest2 = testServer.html(`<title>Dest2</title><script>setTimeout(function(){window.open(${JSON.stringify(b + '?x')})},1500)</script>`, { pubblico: true });
  const page = await openTab(testServer.html(`<a id="l" href="${dest}" style="font-size:40px">vai</a>`));
  await page.click('#l');
  await page.waitForTimeout(3000);
  console.log('E subito', await aperteSu(app, b), (await schede(app)).join(' | '));
  const page2 = await openTab(testServer.html(`<a id="l" href="${dest2}" style="font-size:40px">vai</a>`));
  await page2.click('#l');
  await page.waitForTimeout(4000);
  console.log('E dopo 1.5s', (await schede(app)).filter((u) => u.includes('?x')).length);
});

test('C riquadro pubblicitario con no-referrer usa il clic sulla pagina', async ({ app, openTab, testServer }) => {
  const b = testServer.html('<title>PUBBLICITA</title>');
  const ad = testServer.html(`<p>ad</p><script>setInterval(function(){window.open(${JSON.stringify(b)},'_blank','noopener,noreferrer')},300)</script>`, { pubblico: true });
  const page = await openTab(testServer.html(`<title>Articolo</title><p style="height:200px">testo</p><iframe src="${ad}" width="300" height="100"></iframe>`));
  await expect.poll(() => page.frames().some((f) => f.url() === ad), { timeout: 8000 }).toBe(true);
  await page.waitForTimeout(1500);
  console.log('C prima', await aperteSu(app, b));
  await page.mouse.click(50, 50);
  await page.waitForTimeout(2000);
  console.log('C dopo clic', await aperteSu(app, b));
});

test('B scheda in secondo piano usa il clic dato a quella davanti', async ({ app, openTab, testServer }) => {
  const b = testServer.html('<title>DIETRO</title>');
  await openTab(testServer.html(`<title>Dietro</title><script>setInterval(function(){window.open(${JSON.stringify(b)})},300)</script>`));
  const page = await openTab(testServer.html('<title>Davanti</title><p style="height:300px">testo</p>'));
  await page.waitForTimeout(1500);
  await page.mouse.click(50, 50);
  await page.waitForTimeout(2500);
  console.log('B dopo clic', await aperteSu(app, b));
});
