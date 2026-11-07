// Verifica #2091 giro 2, rilievo 3: due gettoni con lo stesso nome visibile (titoli che cominciano uguali) restano
// ognuno della sua scheda; tolto il primo, quello che resta è ancora la seconda scheda.

import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const idPerUrl = async (shell, url) => (await schede(shell)).find((t) => t.url === url)?.id;

test('r3 tolto il primo di due gettoni dal nome uguale, resta quello della seconda scheda', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const a = testServer.html('<title>Amazon.it: Apple iPhone 15 (128 GB) - Nero</title><p>prodotto A');
  const b = testServer.html('<title>Amazon.it: Apple iPhone 15 Pro (256 GB) - Titanio</title><p>prodotto B');
  await openTab(a);
  await openTab(b);
  const ia = await idPerUrl(shell, a);
  const ib = await idPerUrl(shell, b);
  const casa = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((i) => window.filoShell.tabs.activate(i), casa.id);
  const page = await home(app);
  await page.locator('#input').fill('confronta');
  for (const [k, id] of [[1, ia], [2, ib]]) {
    const r = await page.locator('#input').evaluate((el) => {
      const q = el.getBoundingClientRect();
      return { x: q.left + Math.min(24, q.width / 2), y: q.top + q.height / 2 };
    });
    const v = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
      const tm = w._filoTabs;
      const t = tm.tabs.find((x) => x.id === tm.activeId);
      return { b: t.view.getBounds(), z: t.view.webContents.getZoomFactor() || 1, zs: w.webContents.getZoomFactor() || 1 };
    });
    const verso = { x: (v.b.x + r.x * v.z) / v.zs, y: (v.b.y + r.y * v.z) / v.zs };
    const da = await shell.evaluate((i) => {
      const q = document.querySelector(`.tab[data-id="${i}"]`).getBoundingClientRect();
      return { x: q.left + q.width / 2, y: q.top + q.height / 2 };
    }, id);
    await shell.mouse.move(da.x, da.y);
    await shell.mouse.down();
    await shell.mouse.move(da.x + 8, da.y, { steps: 2 });
    await shell.mouse.move(verso.x, verso.y, { steps: 8 });
    await shell.mouse.up();
    await expect.poll(() => page.evaluate(() => document.getElementById('input')._snGettoni.schede().length), { timeout: 5000 }).toBe(k);
  }
  const urls = () => page.evaluate(() => document.getElementById('input')._snGettoni.schede().map((x) => x.url));
  expect(await urls()).toEqual([a, b]);
  await page.evaluate(() => { const t = document.getElementById('input'); const i = t.value.indexOf('⟧') + 1; t.focus(); t.setSelectionRange(i, i); });
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await urls()).length, { timeout: 5000 }).toBe(1);
  expect(await urls()).toEqual([b]);
});
