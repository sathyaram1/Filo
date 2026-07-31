// TEMP prober probe: open each filo:// page, capture console errors + uncaught
// exceptions on load. High-signal detector for fresh breakage. Removed after run.
import { test, expect } from './fixtures/electron.mjs';

const PAGES = [
  'filo://dashboard/dashboard.html',
  'filo://home/home.html',
  'filo://options/options.html',
  'filo://options/altro.html',
  'filo://security/security.html',
  'filo://preferences/preferences.html',
  'filo://history/history.html',
  'filo://archive/archive.html',
  'filo://feedback/feedback.html',
  'filo://board/board.html',
  'filo://manage/manage.html',
  'filo://credits/credits.html',
  'filo://editor/editor.html',
  'filo://decks/decks.html',
  'filo://spellcheck/spellcheck.html',
];

for (const url of PAGES) {
  test(`no page errors: ${url}`, async ({ openTab }) => {
    const errors = [];
    const page = await openTab(url);
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
    // give the page time to run its init (async fetches, render)
    await page.waitForTimeout(2500);
    if (errors.length) {
      console.log(`\n### ${url}\n` + errors.join('\n'));
    }
    // don't hard-fail; we just want the log. Assert page has a body.
    expect(await page.evaluate(() => !!document.body)).toBe(true);
  });
}
