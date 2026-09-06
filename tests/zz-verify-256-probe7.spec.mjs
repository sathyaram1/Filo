// Sonda temporanea #256 — porta C: una copia altrove mentre punti "Rimuovi".
import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('probe C2: punto "Rimuovi", arriva una copia, clicco', async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 100 - i }));
  const userData = mkdtempSync(join(tmpdir(), 'v256-c2-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: many }), 'utf8');
  const app = await electron.launch({
    args: ['.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    const rows = page.locator('#sec-clip-list .sn-clip-item');
    await expect(rows).toHaveCount(8);

    // L'utente ha la mira sulla riga di "voce-3".
    await rows.nth(3).locator('.sn-clip-remove').hover();
    // In un'altra scheda copia qualcosa: la voce nuova entra in cima.
    await page.evaluate(() => chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.PUSH_CLIPBOARD_ENTRY,
      entry: { type: 'text', text: 'appena-copiata-XYZ' },
    }));
    await expect(rows).toHaveCount(9);
    // Preme senza spostare il mouse.
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(1200);
    const dopo = await page.locator('.sn-clip-text').allInnerTexts();
    console.log('C2-DOPO (voleva togliere voce-3):', JSON.stringify(dopo));
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
