// Sonda temporanea del verificatore #256 — porte della stessa causa:
// la lista si ricompone SOTTO il cursore dopo una rimozione.
import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';

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

async function launch(userData) {
  return electron.launch({
    args: ['.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
}

// Porta B: due clic vicini su DUE voci diverse. Il secondo clic parte quando
// l'utente ha già puntato la riga; se nel frattempo la lista si è ricomposta,
// sotto il cursore c'è un'altra voce.
test('probe B: due clic ravvicinati su due voci diverse (coordinate)', async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 100 - i }));
  const userData = mkdtempSync(join(tmpdir(), 'v256-pb-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: many }), 'utf8');
  const app = await launch(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    const rows = page.locator('#sec-clip-list .sn-clip-item');
    await expect(rows).toHaveCount(8);

    const b1 = await rows.nth(1).locator('.sn-clip-remove').boundingBox();
    const b5 = await rows.nth(5).locator('.sn-clip-remove').boundingBox();
    await page.mouse.click(b1.x + b1.width / 2, b1.y + b1.height / 2);
    await page.waitForTimeout(250);
    await page.mouse.click(b5.x + b5.width / 2, b5.y + b5.height / 2);
    await page.waitForTimeout(1000);
    const dopo = await page.locator('.sn-clip-text').allInnerTexts();
    console.log('B-DOPO', JSON.stringify(dopo), '(voleva togliere voce-1 e voce-5)');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// Porta C: una copia in un'altra scheda arriva MENTRE l'utente sta per togliere
// una voce. La voce nuova entra in cima e spinge giù tutte le altre.
test('probe C: una copia altrove sposta le righe sotto il cursore', async () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 100 - i }));
  const userData = mkdtempSync(join(tmpdir(), 'v256-pc-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: many }), 'utf8');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body style="padding:40px"><p id="p">testo-copiato-altrove</p></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/p`;
  const app = await launch(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    const rows = page.locator('#sec-clip-list .sn-clip-item');
    await expect(rows).toHaveCount(6);
    const b3 = await rows.nth(3).locator('.sn-clip-remove').boundingBox();

    // Copia in un'altra scheda (stesso canale del menu "Copia").
    await page.evaluate(() => chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.PUSH_CLIPBOARD_ENTRY,
      entry: { type: 'text', text: 'appena-copiata-XYZ' },
    }));
    await expect(rows).toHaveCount(7);
    // L'utente aveva già la mira sulla riga di prima e clicca lì.
    await page.mouse.click(b3.x + b3.width / 2, b3.y + b3.height / 2);
    await page.waitForTimeout(1000);
    const dopo = await page.locator('.sn-clip-text').allInnerTexts();
    console.log('C-DOPO', JSON.stringify(dopo), '(voleva togliere voce-3)');
  } finally {
    server.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
