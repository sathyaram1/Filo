import { test, expect } from './fixtures/electron.mjs';

const PAGES = [
  'filo://dashboard/dashboard.html',
  'filo://home/home.html',
  'filo://archive/archive.html',
  'filo://history/history.html',
  'filo://feedback/feedback.html',
  'filo://options/options.html',
  'filo://preferences/preferences.html',
  'filo://security/security.html',
  'filo://credits/credits.html',
  'filo://board/board.html',
  'filo://decks/decks.html',
  'filo://editor/editor.html',
  'filo://spellcheck/spellcheck.html',
  'filo://manage/manage.html',
  'filo://redteam/redteam.html',
];

test('scan pagine filo:// per errori console', async ({ openTab }) => {
  const report = {};
  for (const url of PAGES) {
    const errs = [];
    let page;
    try {
      page = await openTab(url);
    } catch (e) {
      report[url] = ['OPEN FAIL: ' + e.message];
      continue;
    }
    page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 300)); });
    page.on('pageerror', (e) => errs.push('PAGEERROR: ' + String(e).slice(0, 300)));
    await page.waitForTimeout(2500);
    // sanity: qualche elemento visibile
    const bodyLen = await page.evaluate(() => document.body.innerText.trim().length).catch(() => -1);
    report[url] = { errs, bodyLen };
  }
  console.log('=== REPORT ===\n' + JSON.stringify(report, null, 2));
});
