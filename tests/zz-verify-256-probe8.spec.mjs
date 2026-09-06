// Sonda temporanea #256 — "Svuota cronologia" con un filtro di ricerca attivo.
import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIRM_HOST, clickConfirm, confirmText } from './helpers/confirm.mjs';

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

test('probe: filtro attivo + Svuota cronologia', async () => {
  const many = [
    { type: 'text', text: 'password-Hunter2', ts: 100 },
    ...Array.from({ length: 30 }, (_, i) => ({ type: 'text', text: `nota di lavoro ${i}`, ts: 50 - i })),
  ];
  const userData = mkdtempSync(join(tmpdir(), 'v256-f-'));
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
    await expect(rows).toHaveCount(31);

    await page.fill('#sec-clip-search', 'password');
    await expect(rows.locator('visible=true')).toHaveCount(1);
    await page.click('#sec-clip-clear');
    await expect(page.locator(CONFIRM_HOST)).toBeVisible();
    console.log('CONFERMA-CON-FILTRO:', JSON.stringify(await confirmText(page)));
    await clickConfirm(page, 'ok');
    await page.waitForTimeout(800);
    const restanti = await page.evaluate(async () => {
      const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY });
      return (r.items || []).length;
    });
    console.log('RESTANTI-SU-DISCO:', restanti, '(l\'utente vedeva 1 voce sola)');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
