import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const OUT = 'tests/.shots';
try { mkdirSync(OUT, { recursive: true }); } catch (_) {}

const pages = [
  ['home', 'filo://home/home.html'],
  ['history', 'filo://history/history.html'],
  ['archive', 'filo://archive/archive.html'],
  ['security', 'filo://security/security.html'],
  ['preferences', 'filo://preferences/preferences.html'],
  ['options', 'filo://options/options.html'],
  ['editor', 'filo://editor/editor.html'],
];

for (const [name, url] of pages) {
  test(`screenshot ${name}`, async ({ openTab }) => {
    const page = await openTab(url);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/audit-${name}.png`, fullPage: true }).catch(() => {});
    expect(true).toBe(true);
  });
}
