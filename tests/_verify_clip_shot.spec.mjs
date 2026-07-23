import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('shot: submenu con × e svuota', async ({ testServer }) => {
  const history = [
    { type: 'text', text: 'password: hunter2', ts: Date.now() - 5000 },
    { type: 'text', text: 'Un testo molto lungo che dovrebbe essere troncato con i puntini per non sballare la larghezza del menu della cronologia', ts: Date.now() - 4000 },
    { type: 'image', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', description: 'immagine copiata', ts: Date.now() - 3000 },
    { type: 'text', text: 'ciao mondo', ts: Date.now() - 1000 },
  ];
  const userData = mkdtempSync(join(tmpdir(), 'filo-clip-shot-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: history }), 'utf8');

  const url = testServer.html(
    `<!doctype html><html><body style="padding:60px;background:#f5f5f5"><textarea id="ta" rows="6" cols="60"></textarea></body></html>`,
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

    await page.locator('#ta').click({ button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible();
    await page.locator('.sn-menu-paste-arrow').click();
    const sub = page.locator('.sn-menu-history-sub');
    await expect(sub).toBeVisible();
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(4);
    await expect(sub.locator('.sn-menu-history-remove')).toHaveCount(4);
    await expect(sub.locator('.sn-menu-history-clear-btn')).toBeVisible();

    const dir = join(APP_ROOT, 'tests', '.shots');
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, 'clip-submenu.png') });

    // Clic sulla × della prima voce → sparisce, restano 3
    await sub.locator('.sn-menu-history-remove').first().click();
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(3);
    await page.screenshot({ path: join(dir, 'clip-submenu-after-remove.png') });

    // Apri conferma svuota
    await sub.locator('.sn-menu-history-clear-btn').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(dir, 'clip-clear-confirm.png') });
  } finally {
    await app.close();
  }
});
