import { test, expect } from '/home/user/Filo/tests/fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP_ROOT = '/home/user/Filo';
test('menu del tasto destro su una pagina filo://', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'probe-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    clipboardHistory: [{ type: 'text', text: 'aaa', ts: 3 }, { type: 'text', text: 'bbb', ts: 2 }],
  }), 'utf8');
  const app = await electron.launch({ args: ['.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
    let page = null;
    for (let i = 0; i < 100 && !page; i++) {
      page = app.windows().find((p) => { try { return new URL(p.url()).hostname === 'security'; } catch (_) { return false; } });
      if (!page) await new Promise((r) => setTimeout(r, 100));
    }
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(800);
    await page.locator('#sec-clip-search').click({ button: 'right' });
    await page.waitForTimeout(600);
    const info = await page.evaluate(() => ({
      menu: !!document.querySelector('.sn-menu'),
      arrow: !!document.querySelector('.sn-menu-paste-arrow'),
      confirmUi: typeof window.SN_CONFIRM_UI,
      testHook: !!(window.SN_CONFIRM_UI && window.SN_CONFIRM_UI._test),
    }));
    console.log('PROBE >>>', JSON.stringify(info));
  } finally { try { await app.close(); } catch (_) {} rmSync(userData, { recursive: true, force: true }); }
});
