// #871 giro 7, rilievo 1: su un sito, Home dalla barra e poi Indietro deve riportare al sito, come in ogni browser.
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const urlAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t && t.url;
});

test('r1 sito, Home dalla barra, poi Indietro dalla barra: si torna al sito', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><title>A</title><body><h1>A</h1></body>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="home"]').click();
  await expect.poll(() => urlAttiva(app)).toMatch(/^filo:\/\/newtab\//);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const back = barra.locator('#nav .ico[data-id="back"]');
  await expect(back).toHaveAttribute('aria-disabled', 'false');
  await back.click();
  await expect.poll(() => urlAttiva(app)).toBe(a);
});
