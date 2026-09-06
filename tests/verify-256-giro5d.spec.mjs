// Feedback #256 — giro 5, quarta tornata: la conferma dello svuotamento nel
// menu "Incolla" con UNA sola voce, e la cronologia del menu in tema scuro.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { CONFIRM_HOST } from './helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}
const PAGE = '<!doctype html><html><body style="padding:40px;background:#fff"><textarea id="ta" rows="4" cols="40"></textarea></body></html>';
const ROSSO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mO4Y2NEEmIY1TCqYfhqAAAatkoQSZYreAAAAABJRU5ErkJggg==';

async function findTabPage(app, hostname, timeout = 20000) {
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

function avvia(userData) {
  return electron.launch({
    args: ['.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
}

function conCronologia(prefix, items, extra) {
  const userData = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: items, ...extra }), 'utf8');
  return userData;
}

async function serviPagina() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/p`, close: () => server.close() };
}

test('menu Incolla: una voce sola, cosa dice la conferma', async () => {
  const userData = conCronologia('g5d-una-', [{ type: 'text', text: 'unica-voce', ts: 1 }]);
  const srv = await serviPagina();
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), srv.url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 15000 });
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    const sub = web.locator('.sn-menu-history-sub');
    await expect(sub).toBeVisible();
    await sub.locator('.sn-menu-history-clear-btn').click();
    await expect(web.locator(CONFIRM_HOST)).toBeVisible();
    await web.screenshot({ path: join(SHOTS, 'g5d-menu-una-voce.png') });
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('menu Incolla: tema scuro, la cronologia con miniature', async () => {
  const items = [
    { type: 'image', dataUrl: ROSSO, ts: 5 },
    { type: 'text', text: '     ', ts: 4 },
    { type: 'text', text: 'L'.repeat(10000), ts: 3 },
    { type: 'text', text: '🎉 àèìòù 中文', ts: 2 },
  ];
  const userData = conCronologia('g5d-scuro-', items, { settings: { theme: 'dark' } });
  const srv = await serviPagina();
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), srv.url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 15000 });
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    const sub = web.locator('.sn-menu-history-sub');
    await expect(sub).toBeVisible();
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(4);
    await web.waitForTimeout(400);
    await web.screenshot({ path: join(SHOTS, 'g5d-menu-scuro.png') });
    const box = await sub.boundingBox();
    const vp = web.viewportSize() || { width: 1280, height: 800 };
    console.log('SUB-BOX-SCURO >>>', JSON.stringify(box), JSON.stringify(vp));
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 2);
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
