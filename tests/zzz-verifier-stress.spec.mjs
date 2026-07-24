import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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

test('verifier stress', async () => {
  const now = Date.now();
  const longWord = 'X'.repeat(410) + 'NEEDLEBEYOND';
  const aiHistory = [
    { id: 'h-1', timestamp: new Date(now).toISOString(), action: 'explain',
      provider: 'gemini', model: 'gemini-2.0-flash', input: { selection: 'melanzana viola' },
      output: 'ortaggio estivo', origin: 'https://example.com', costEur: 0.0001 },
    { id: 'h-2', timestamp: new Date(now-1000).toISOString(), action: 'translate_selection',
      provider: 'gemini', model: 'gemini-2.0-flash', input: { selection: 'cammello curioso' },
      output: 'animale del deserto', origin: 'https://x.com', costEur: 0.0001 },
    { id: 'h-3', timestamp: new Date(now-2000).toISOString(), action: 'filo_chat',
      provider: 'gemini', model: 'gemini-2.0-flash', input: { userMessage: '<script>window.__x=1</script> pizza' },
      output: 'cibo <b>grassetto</b>', origin: 'https://x.com', costEur: 0.0001 },
    { id: 'h-4', timestamp: new Date(now-3000).toISOString(), action: 'explain',
      provider: 'gemini', model: 'gemini-2.0-flash', input: { selection: longWord },
      output: 'lungo', origin: 'https://x.com', costEur: 0.0001 },
  ];
  const userData = mkdtempSync(join(tmpdir(), 'filo-stress-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ aiHistory }), 'utf8');
  const app = await electron.launch({ args: ['.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
    const page = await findTabPage(app, 'history');
    await page.waitForLoadState('domcontentloaded');
    const search = page.locator('#search');
    await expect(page.locator('.sn-history-item')).toHaveCount(4);

    // 1) JSON artifacts / internal keys / punctuation must find nothing
    for (const ghost of ['input', 'provider', 'costEur', '{', '":"', 'timestamp', 'action']) {
      await search.fill(ghost);
      await expect(page.locator('.sn-history-item'), `ghost ${ghost}`).toHaveCount(0);
    }

    // 2) action label searchable (initiative): "traduci" -> the translate entry
    await search.fill('traduci');
    await expect(page.locator('.sn-history-item')).toHaveCount(1);
    await expect(page.locator('#list')).toContainText('cammello curioso');

    // 3) XSS: script must NOT have executed, and no phantom global set
    const xss = await page.evaluate(() => window.__x);
    expect(xss).toBeUndefined();
    // searching the visible literal text still works (it's shown as text)
    await search.fill('pizza');
    await expect(page.locator('.sn-history-item')).toHaveCount(1);

    // 4) empty / whitespace-only search -> all back
    await search.fill('   ');
    await expect(page.locator('.sn-history-item')).toHaveCount(4);
    await search.fill('');
    await expect(page.locator('.sn-history-item')).toHaveCount(4);

    // 5) emoji / special chars don't crash, just no match
    await search.fill('🍕🚀');
    await expect(page.locator('.sn-history-item')).toHaveCount(0);

    // 6) documented limit: word beyond 400-char truncation NOT found
    await search.fill('needlebeyond');
    await expect(page.locator('.sn-history-item')).toHaveCount(0);

    // 7) origin/url searchable
    await search.fill('example.com');
    await expect(page.locator('.sn-history-item')).toHaveCount(1);
  } finally {
    try { await app.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
