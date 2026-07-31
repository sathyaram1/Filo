// TEMPORANEO — spec esplorativa dell'audit prober. Da cancellare a fine audit.
import { test, expect } from './fixtures/electron.mjs';

const PAGES = [
  'filo://newtab/',
  'filo://dashboard/dashboard.html',
  'filo://options/options.html',
  'filo://preferences/preferences.html',
  'filo://history/history.html',
  'filo://archive/archive.html',
  'filo://board/board.html',
  'filo://decks/decks.html',
  'filo://editor/editor.html',
  'filo://feedback/feedback.html',
  'filo://spellcheck/spellcheck.html',
  'filo://credits/credits.html',
  'filo://security/security.html',
  'filo://redteam/redteam.html',
  'filo://manage/manage.html',
  'filo://home/home.html',
];

test('esplora pagine interne: errori console e stato vuoto', async ({ openTab }) => {
  test.setTimeout(240_000);
  const report = [];
  for (const url of PAGES) {
    let page;
    const errs = [];
    try {
      page = await openTab(url);
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
      page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
      await page.waitForTimeout(1500);
      const info = await page.evaluate(() => ({
        title: document.title,
        bodyLen: document.body.innerText.trim().length,
        head: document.body.innerText.trim().slice(0, 160).replace(/\s+/g, ' '),
      }));
      report.push({ url, ...info, errs });
    } catch (e) {
      report.push({ url, error: String(e).slice(0, 200), errs });
    }
  }
  console.log('=== REPORT ===\n' + JSON.stringify(report, null, 1));
});
