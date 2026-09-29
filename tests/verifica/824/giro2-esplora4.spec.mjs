// #824 giro 2: Indietro con la bozza in un riquadro.

import { test, expect } from '../../fixtures/electron.mjs';

async function apriEsatta(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

const moduloDi = (shell, title) => shell.evaluate(async (t) => {
  const s = await window.filoShell.tabs.snapshot();
  const tab = s.tabs.find((x) => x.title === t);
  return tab ? tab.formDirty : null;
}, title);

test('Indietro con la bozza in un riquadro', async ({ app, shell, testServer }) => {
  const dentro = testServer.html('<!doctype html><textarea id="t"></textarea>', { pubblico: true });
  const dopo = testServer.html('<!doctype html><title>Dopo</title><p>dopo');
  const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>Commenti</title></head><body>
    <iframe id="f" src="${dentro}" style="width:400px;height:150px"></iframe><a id="via" href="${dopo}">vai</a>
    <script>window.addEventListener('unload', () => {});</script></body></html>`));
  await page.frameLocator('#f').locator('#t').click();
  await page.keyboard.type('Commento nel riquadro');
  await expect.poll(() => moduloDi(shell, 'Commenti'), { timeout: 8000 }).toBe(true);
  await page.locator('#via').click();
  await expect.poll(() => moduloDi(shell, 'Dopo'), { timeout: 8000 }).toBe(false);
  await page.goBack();
  await page.waitForFunction(() => document.title === 'Commenti');
  await page.waitForTimeout(1500);
  const v = await page.frameLocator('#f').locator('#t').inputValue();
  console.log('INDIETRO valore', JSON.stringify(v), 'formDirty', await moduloDi(shell, 'Commenti'));
});
