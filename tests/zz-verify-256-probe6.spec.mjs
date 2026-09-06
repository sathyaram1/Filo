// Sonda temporanea #256 — il sotto-menu "Incolla" con due immagini copiate.
import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try { mkdirSync(join(APP_ROOT, 'tests', '.shots'), { recursive: true }); } catch (_) {}
const ROSSO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAJ0lEQVR42u3NMQEAAAgDoC251a3gLwSgcqfTaDQajUaj0Wg0Go3mYQGvxAV/1jRlpQAAAABJRU5ErkJggg==';
const BLU = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAKUlEQVR42u3NMQEAAAgDoJvc6BpjDwSgcqfTaDQajUaj0Wg0Go1G8/ABsdwFf6Vd7ncAAAAASUVORK5CYII=';

async function findTabPage(app, hostname, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const w = app.windows().find((p) => {
      try { return new URL(p.url()).hostname === hostname; } catch (_) { return false; }
    });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test('probe: due immagini copiate nel sotto-menu Incolla', async () => {
  const items = [
    { type: 'image', dataUrl: ROSSO, ts: 3 },
    { type: 'image', dataUrl: BLU, ts: 2 },
    { type: 'text', text: 'password-Hunter2', ts: 1 },
  ];
  const userData = mkdtempSync(join(tmpdir(), 'v256-img-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: items }), 'utf8');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="4" cols="40"></textarea></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/p`;
  const app = await electron.launch({
    args: ['.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10000 });
    await web.locator('#ta').click({ button: 'right' });
    await expect(web.locator('.sn-menu')).toBeVisible();
    await web.locator('.sn-menu-paste-arrow').click();
    const sub = web.locator('.sn-menu-history-sub');
    await expect(sub).toBeVisible();
    const html = await sub.evaluate((n) => n.innerHTML.slice(0, 1500));
    console.log('SUBMENU-HTML', html.replace(/\s+/g, ' '));
    console.log('MINIATURE-NEL-MENU', await sub.locator('img').count());
    await web.screenshot({ path: 'tests/.shots/v256-g4-menu-immagini.png' });
  } finally {
    server.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
