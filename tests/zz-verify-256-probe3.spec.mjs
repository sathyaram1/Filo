// Sonda temporanea #256 — cosa finisce sotto il puntatore dopo una rimozione.
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

test('probe: elementFromPoint dopo una rimozione e dopo una copia altrove', async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 100 - i }));
  const userData = mkdtempSync(join(tmpdir(), 'v256-pe-'));
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

    const punto = await page.evaluate(() => {
      const r = document.querySelectorAll('#sec-clip-list .sn-clip-item')[5];
      const b = r.querySelector('.sn-clip-remove').getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, era: r.querySelector('.sn-clip-text').textContent };
    });
    // Tolgo la voce-1: la lista si ricompone.
    await rows.nth(1).locator('.sn-clip-remove').click();
    await expect(rows).toHaveCount(7);
    const sotto = await page.evaluate((p) => {
      const el = document.elementFromPoint(p.x, p.y);
      const row = el && el.closest && el.closest('.sn-clip-item');
      return row ? row.querySelector('.sn-clip-text').textContent : String(el && el.className);
    }, punto);
    console.log(`REFLOW-RIMOZIONE: puntavi "${punto.era}", ora lì c'è "${sotto}"`);

    // Ora una copia in un'altra scheda: entra in cima, spinge giù tutto.
    const punto2 = await page.evaluate(() => {
      const r = document.querySelectorAll('#sec-clip-list .sn-clip-item')[3];
      const b = r.querySelector('.sn-clip-remove').getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, era: r.querySelector('.sn-clip-text').textContent };
    });
    await page.evaluate(() => chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.PUSH_CLIPBOARD_ENTRY,
      entry: { type: 'text', text: 'appena-copiata-XYZ' },
    }));
    await expect(rows).toHaveCount(8);
    const sotto2 = await page.evaluate((p) => {
      const el = document.elementFromPoint(p.x, p.y);
      const row = el && el.closest && el.closest('.sn-clip-item');
      return row ? row.querySelector('.sn-clip-text').textContent : String(el && el.className);
    }, punto2);
    console.log(`REFLOW-COPIA: puntavi "${punto2.era}", ora lì c'è "${sotto2}"`);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
