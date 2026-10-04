import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'provenienza');

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ shell, openTab, testServer }) => {
    await shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { theme: t } }), tema);
    const src = testServer.asset(readFileSync(join(FIXTURE, 'c2pa-ufficiale-ai.jpg')), 'image/jpeg');
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
      <img id="foto" src="${src}" width="200" height="200"></body></html>`);
    await page.waitForFunction((t) => document.documentElement.dataset.snTheme === t || t === 'light', tema, { timeout: 8000 }).catch(() => {});
    await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    await expect(page.locator('.sn-menu .sn-menu-origine')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `tests/.shots/946-giro5-${tema}.png` });
  });
}
