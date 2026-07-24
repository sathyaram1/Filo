import { test } from './fixtures/electron.mjs';
import fs from 'node:fs';

test('shot menu App #292', async ({ shell, app }) => {
  await shell.evaluate(() => document.getElementById('nav-apps')?.click());
  const deadline = Date.now() + 5000;
  let win = null;
  while (Date.now() < deadline && !win) {
    win = app.windows().find((w) => w.url().startsWith('data:text/html'));
    if (!win) await new Promise((r) => setTimeout(r, 100));
  }
  if (!win) throw new Error('no popup');
  await win.waitForSelector('.item', { timeout: 2000 }).catch(() => {});
  fs.mkdirSync('tests/.shots', { recursive: true });
  await win.screenshot({ path: 'tests/.shots/verify292-appmenu.png' });
  // dump labels + whether each has svg
  const rows = await win.$$eval('.item', (els) =>
    els.map((e) => ({ label: e.textContent.trim(), svg: !!e.querySelector('.ico svg') })));
  console.log('MENU=' + JSON.stringify(rows));
});
