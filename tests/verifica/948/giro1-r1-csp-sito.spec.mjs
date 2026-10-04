// Verifica #948 giro 1: su un sito con CSP restrittiva (style-src senza filo:) il microfono dell'Aiuto
// deve avere lo stesso aspetto che altrove: tondo da 32 px, la sola icona del microfono, niente anello.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'";
let server; let port;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP });
    res.end('<!doctype html><title>Sito CSP</title><body style="font:16px sans-serif;padding:40px"><h1>Sito con CSP</h1></body>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = String(server.address().port);
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

test('Aiuto su un sito con CSP: il microfono ha il suo aspetto', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await openTab(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers: ['alt'] });
    t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'H', modifiers: ['alt'] });
  });
  const mic = page.locator('.sn-sidebar .sn-voce-btn');
  await expect(mic).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(800);
  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/verifica-948-csp-aiuto.png' });
  const box = await mic.boundingBox();
  expect(Math.round(box.width)).toBe(32);
  expect(Math.round(box.height)).toBe(32);
  await expect(mic.locator('.sn-voce-x')).toBeHidden();
  await expect(mic.locator('.sn-voce-anello')).toBeHidden();
});
