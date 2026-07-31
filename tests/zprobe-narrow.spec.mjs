// PROBE (prober): pagine interne con la finestra stretta.
import { test, expect } from './fixtures/electron.mjs';

const PAGES = [
  ['dashboard', 'filo://dashboard/dashboard.html'],
  ['archive', 'filo://archive/archive.html'],
  ['options', 'filo://options/options.html'],
  ['preferences', 'filo://preferences/preferences.html'],
  ['security', 'filo://security/security.html'],
  ['decks', 'filo://decks/decks.html'],
  ['editor', 'filo://editor/editor.html'],
  ['feedback', 'filo://feedback/feedback.html'],
  ['credits', 'filo://credits/credits.html'],
  ['spellcheck', 'filo://spellcheck/spellcheck.html'],
];

test('probe: finestra stretta 720x560', async ({ app, openTab }) => {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(720, 560);
  });
  const out = [];
  for (const [name, url] of PAGES) {
    const page = await openTab(url);
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => ({
      docW: document.documentElement.scrollWidth,
      cliW: document.documentElement.clientWidth,
      bodyW: document.body.scrollWidth,
    }));
    out.push(`${name}: docScrollW=${m.docW} clientW=${m.cliW} bodyScrollW=${m.bodyW} ${m.docW > m.cliW + 2 ? 'OVERFLOW-X!' : ''}`);
    await page.screenshot({ path: `tests/.shots/probe-narrow-${name}.png` });
  }
  console.log('\n=== NARROW ===\n' + out.join('\n'));
  expect(out.length).toBe(PAGES.length);
});
