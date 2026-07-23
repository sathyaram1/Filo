import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIRM_HOST } from './helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function findTabPage(app, hostname, timeout = 10000) {
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

async function openHistorySubmenu(page) {
  await page.locator('#ta').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  const arrow = page.locator('.sn-menu-paste-arrow');
  await expect(arrow).toBeVisible();
  await arrow.click();
  const sub = page.locator('.sn-menu-history-sub');
  await expect(sub).toBeVisible();
  return sub;
}

test('stress: XSS, emoji, testo lungo, immagine, ultima voce -> stato vuoto, svuota conferma', async ({ testServer }) => {
  const XSS = '<script>window.__pwned=1</script><img src=x onerror="window.__pwned=1">';
  const LONG = 'A'.repeat(10000);
  const EMOJI = '🔥🔥 password 🔥🔥 città naïve';
  const history = [
    { type: 'text', text: XSS, ts: Date.now() - 5000 },
    { type: 'text', text: LONG, ts: Date.now() - 4000 },
    { type: 'text', text: EMOJI, ts: Date.now() - 3000 },
    { type: 'image', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', description: 'immagine sensibile', ts: Date.now() - 2000 },
  ];
  const userData = mkdtempSync(join(tmpdir(), 'filo-clip-stress-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: history }), 'utf8');

  const url = testServer.html(
    `<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="5" cols="60"></textarea></body></html>`,
  );
  const host = new URL(url).hostname;

  const app = await electron.launch({
    args: ['.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const page = await findTabPage(app, host);
    expect(page).toBeTruthy();
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

    let sub = await openHistorySubmenu(page);
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(4);
    await expect(sub.locator('.sn-menu-history-remove')).toHaveCount(4);

    // XSS: lo script NON deve essere eseguito (textContent, non innerHTML).
    const pwned = await page.evaluate(() => window.__pwned === 1);
    expect(pwned, 'lo script iniettato non deve eseguirsi').toBeFalsy();

    // Testo lungo: la label è troncata (non 10000 char nel DOM).
    const labels = await sub.locator('.sn-menu-history-paste .sn-menu-label').allTextContents();
    const maxLen = Math.max(...labels.map((t) => t.length));
    expect(maxLen, 'le label devono essere troncate').toBeLessThan(60);

    // Rimuovi l'immagine (voce non-testo): deve sparire e restare rimossa.
    const imgRow = sub.locator('.sn-menu-history-item', { hasText: 'immagine sensibile' });
    await expect(imgRow).toHaveCount(1);
    await imgRow.locator('.sn-menu-history-remove').click();
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(3);

    // Rimuovi le 3 testuali una a una: all'ultima compare lo stato vuoto.
    for (let i = 0; i < 3; i++) {
      await sub.locator('.sn-menu-history-item').first().locator('.sn-menu-history-remove').click();
    }
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(0);
    await expect(sub.locator('.sn-menu-empty')).toContainText('Cronologia appunti vuota');

    // Persistenza: riapri -> resta tutto vuoto (rimozioni salvate).
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
    await page.locator('#ta').click({ button: 'right' });
    const arrow = page.locator('.sn-menu-paste-arrow');
    await arrow.click();
    // Sotto-menu ora è lo stato vuoto (non history-sub): messaggio vuoto visibile.
    await expect(page.locator('.sn-menu-sub .sn-menu-empty')).toContainText('Cronologia appunti vuota');

    await page.screenshot({ path: 'tests/.shots/vfy256-stress.png' });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
