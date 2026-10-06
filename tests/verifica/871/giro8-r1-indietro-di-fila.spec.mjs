// #871 giro 8: Indietro e Avanti premuti di fila, prima che la pagina di destinazione si carichi.
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const statoTab = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return { url: t.url, storia: t.storia, canBack: t.canBack, canFwd: t.canFwd,
    dietro: w._filoTabs.vociCronologia('indietro').map((v) => v.url), davanti: w._filoTabs.vociCronologia('avanti').map((v) => v.url) };
});
const nav = (app, verso) => app.evaluate(({ BrowserWindow }, v) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.navigaCronologia(v);
}, verso);

async function preparazione(app, openTab, testServer) {
  const a = testServer.html('<!doctype html><title>A</title><body><h1>A</h1></body>');
  const b = testServer.html('<!doctype html><title>B</title><body><h1>B</h1></body>');
  const c = testServer.html('<!doctype html><title>C</title><body><h1>C</h1></body>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.evaluate((u) => { location.href = u; }, b);
  await page.waitForURL(b);
  await pausa(300);
  const v = app.windows().find((w) => { try { return w.url() === b; } catch (_) { return false; } });
  await v.evaluate((u) => { location.href = u; }, c);
  await expect.poll(async () => (await statoTab(app)).url).toBe(c);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="home"]').click();
  await expect.poll(async () => (await statoTab(app)).url).toMatch(/^filo:\/\/newtab\//);
  await pausa(800);
  return { a, b, c };
}

test('r1 Indietro tre volte di fila dalla home: si arriva al primo sito e Avanti ripassa da tutte le pagine', async ({ app, openTab, testServer }) => {
  const { a, b, c } = await preparazione(app, openTab, testServer);
  await nav(app, 'indietro'); await pausa(150);
  await nav(app, 'indietro'); await pausa(150);
  await nav(app, 'indietro');
  await pausa(2000);
  const s = await statoTab(app);
  expect(s.url).toBe(a);
  expect(s.davanti).toEqual([b, c, expect.stringMatching(/^filo:\/\/newtab/)]);
});

test('r1 Avanti due volte di fila: Indietro ripassa dalla pagina saltata', async ({ app, openTab, testServer }) => {
  const { a, b, c } = await preparazione(app, openTab, testServer);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const v = w._filoTabs.vociCronologia('indietro');
    w._filoTabs.vaiAllaVoce(w._filoTabs.activeId, v[2].indice);
  });
  await pausa(1500);
  expect((await statoTab(app)).url).toBe(a);
  await nav(app, 'avanti'); await pausa(150);
  await nav(app, 'avanti');
  await pausa(2000);
  const s = await statoTab(app);
  expect(s.url).toBe(c);
  expect(s.dietro).toEqual([b, a]);
});

test('r1 Home e subito Indietro: Avanti riporta alla home', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><title>A</title><body><h1>A</h1></body>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.navigate(w._filoTabs.activeId, 'filo://newtab/');
  });
  await pausa(100);
  await nav(app, 'indietro');
  await pausa(2000);
  const s = await statoTab(app);
  expect(s.url).toBe(a);
  expect(s.davanti).toEqual([expect.stringMatching(/^filo:\/\/newtab/)]);
});
