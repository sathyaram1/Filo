// VERIFICA #427 — chiude la catena "fuoco sulla barra" + traccia visiva. (temporaneo)
import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const z = (page) => page.evaluate(() => window.devicePixelRatio);

test('la pagina reagisce al comando di zoom inviato dalla barra', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForTimeout(900);
  const base = await z(page);

  const send = (dir) => app.evaluate(async ({ webContents }, d) => {
    const wc = webContents.getAllWebContents().find((w) => {
      try { return w.getURL().includes('manage'); } catch (_) { return false; }
    });
    if (!wc) return false;
    wc.send('filo:zoom-key', d);
    return true;
  }, dir);

  expect(await send('in')).toBe(true);
  await page.waitForTimeout(200);
  expect(await send('in')).toBe(true);
  await page.waitForTimeout(400);
  const up = await z(page);
  console.log('[427] zoom-key in :', base, '->', up);
  expect(up, 'il comando di zoom dalla barra deve ingrandire la pagina').toBeGreaterThan(base);

  await send('out');
  await page.waitForTimeout(400);
  const down = await z(page);
  console.log('[427] zoom-key out :', up, '->', down);
  expect(down).toBeLessThan(up);

  await send('reset');
  await page.waitForTimeout(400);
  const reset = await z(page);
  console.log('[427] zoom-key reset :', down, '->', reset);
  expect(reset).toBeCloseTo(base, 3);
});

test('traccia visiva: Gestione al 100% e ingrandita', async ({ openTab }) => {
  mkdirSync('tests/.shots', { recursive: true });
  const page = await openTab('filo://manage/manage.html');
  await page.waitForTimeout(1500);
  await page.mouse.click(400, 300).catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/427-manage-100.png' });

  for (let i = 0; i < 4; i++) { await page.keyboard.press('Control+Equal'); await page.waitForTimeout(150); }
  await page.waitForTimeout(600);
  console.log('[427] dpr per screenshot ingrandito:', await z(page));
  await page.screenshot({ path: 'tests/.shots/427-manage-zoom.png' });

  await page.keyboard.press('Control+0');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/427-manage-reset.png' });
});
