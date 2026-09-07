// #256, giro 5 — dove compare davvero la freccia della cronologia: quali campi
// di testo la offrono e quali no.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = '<!doctype html><html><body style="padding:30px">'
  + '<textarea id="ta" rows="3" cols="30"></textarea><br><br>'
  + '<input id="txt" type="text" size="30"><br><br>'
  + '<input id="mail" type="email" size="30"><br><br>'
  + '<input id="pw" type="password" size="30"><br><br>'
  + '<div id="ce" contenteditable="true" style="border:1px solid #999;width:300px;height:60px"></div>'
  + '</body></html>';

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

test('W1 — la freccia della cronologia campo per campo', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'g5e-campi-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    clipboardHistory: [{ type: 'text', text: 'voce-in-cronologia' }],
  }), 'utf8');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
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
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 20000 });

    for (const id of ['ta', 'txt', 'mail', 'pw', 'ce']) {
      await web.locator(`#${id}`).click();
      await web.waitForTimeout(150);
      await web.locator(`#${id}`).click({ button: 'right' });
      await web.waitForTimeout(500);
      const stato = await web.evaluate(() => ({
        incolla: !!document.querySelector('.sn-menu-paste-main'),
        freccia: !!document.querySelector('.sn-menu-paste-arrow'),
        voci: [...document.querySelectorAll('.sn-menu .sn-menu-label')].map((s) => s.textContent.trim()).filter(Boolean),
      }));
      console.log(`[W1] ${id}:`, JSON.stringify(stato));
      await web.keyboard.press('Escape');
      await web.waitForTimeout(250);
    }
  } finally {
    server.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
