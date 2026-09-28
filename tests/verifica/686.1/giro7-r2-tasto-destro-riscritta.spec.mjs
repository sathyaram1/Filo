// #686.1 — giro 7, rilievo 2: un documento riscritto dal sito cancella anche
// l'ascoltatore del tasto destro di Filo, e con lui la voce «Dimensione reale».

import { test, expect } from '../../fixtures/electron.mjs';

async function percentOf(app, page) {
  const url = await page.evaluate(() => location.href);
  const f = await app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) return wc.getZoomFactor();
    }
    return null;
  }, url);
  return f == null ? null : Math.round(f * 100);
}

async function ctrl(app, page, keyCode) {
  const url = await page.evaluate(() => location.href);
  await app.evaluate(({ webContents }, { u, keyCode }) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here !== u) continue;
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] });
    }
  }, { u: url, keyCode });
}

test('dopo che il sito riscrive il documento il tasto destro apre il menu e riporta alla dimensione reale', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="height:4000px"><h1>un sito</h1></body></html>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  // Prima della riscrittura il menu c'è.
  await page.locator('h1').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.click(600, 600);

  await page.evaluate(() => {
    document.open();
    document.write('<!doctype html><html><body style="height:4000px"><h1>riscritta</h1></body></html>');
    document.close();
  });
  await page.waitForTimeout(500);
  await ctrl(app, page, '=');
  await ctrl(app, page, '=');
  await expect.poll(async () => percentOf(app, page)).toBe(120);

  await page.locator('h1').click({ button: 'right' });
  const voce = page.locator('.sn-menu').getByText(/Dimensione reale \(ora 120%\)/);
  await expect(voce, 'il tasto destro non apre più il menu di Filo').toBeVisible({ timeout: 4000 });
  await voce.click();
  await expect.poll(async () => percentOf(app, page)).toBe(100);
});
