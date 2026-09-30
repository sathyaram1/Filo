// Esplorazione verifica #428 giro 2 (da cancellare): puntatore vero via xdotool.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';

const xdo = (...a) => execFileSync('xdotool', a.map(String), { encoding: 'utf8' });

async function larghezze(shell) {
  return shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((el) => Math.round(el.getBoundingClientRect().width * 10) / 10));
}

async function apri(shell, n) {
  await shell.evaluate(async (k) => { for (let i = 0; i < k; i++) await window.filoShell.tabs.open('filo://newtab/'); }, n - 1);
  await expect(shell.locator('#tabs .tab')).toHaveCount(n, { timeout: 15_000 });
  await shell.waitForTimeout(1500);
}

test('puntatore vero: chiusura, poi discesa sulla pagina', async ({ app, shell }) => {
  await apri(shell, 12);
  const b = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.focus(); return { c: w.getContentBounds(), z: w.webContents.getZoomFactor() }; });
  console.log('bounds', JSON.stringify(b));
  const scr = (x, y) => [Math.round(b.c.x + x * b.z), Math.round(b.c.y + y * b.z)];
  // attiva la prima
  const first = await shell.locator('#tabs .tab').first().boundingBox();
  xdo('mousemove', ...scr(first.x + 20, 20)); await shell.waitForTimeout(200);
  xdo('click', 1); await shell.waitForTimeout(500);
  console.log('prima', JSON.stringify(await larghezze(shell)));
  const r = await shell.evaluate(() => document.querySelectorAll('#tabs .tab')[5].querySelector('.close').getBoundingClientRect().toJSON());
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  xdo('mousemove', ...scr(cx - 30, cy)); await shell.waitForTimeout(150);
  xdo('mousemove', ...scr(cx, cy)); await shell.waitForTimeout(300);
  const n0 = await shell.locator('#tabs .tab').count();
  xdo('click', 1); await shell.waitForTimeout(700);
  console.log('dopo 1', await shell.locator('#tabs .tab').count(), JSON.stringify(await larghezze(shell)));
  xdo('click', 1); await shell.waitForTimeout(700);
  console.log('dopo 2', await shell.locator('#tabs .tab').count(), JSON.stringify(await larghezze(shell)));
  console.log('puntatore dal main', JSON.stringify(await shell.evaluate(() => window.filoShell.puntatore())));
  // scende sulla pagina
  for (let y = cy; y <= 300; y += 15) { xdo('mousemove', ...scr(cx, y)); await shell.waitForTimeout(30); }
  await shell.waitForTimeout(800);
  console.log('sulla pagina', JSON.stringify(await larghezze(shell)));
  console.log('puntatore dal main', JSON.stringify(await shell.evaluate(() => window.filoShell.puntatore())));
  expect(n0).toBe(12);
});
