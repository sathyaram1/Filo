// PROBE temporaneo (routine prober): apre tutte le pagine filo:// e raccoglie
// errori runtime / stati rotti. Non è uno spec di regressione: serve solo a
// far emergere problemi da segnalare.
import { test, expect } from './fixtures/electron.mjs';

const PAGES = [
  'filo://home/home.html',
  'filo://dashboard/dashboard.html',
  'filo://archive/archive.html',
  'filo://history/history.html',
  'filo://options/options.html',
  'filo://options/altro.html',
  'filo://preferences/preferences.html',
  'filo://security/security.html',
  'filo://spellcheck/spellcheck.html',
  'filo://feedback/feedback.html',
  'filo://board/board.html',
  'filo://credits/credits.html',
  'filo://decks/decks.html',
  'filo://editor/editor.html',
  'filo://redteam/redteam.html',
  'filo://manage/manage.html',
  'filo://admin-defaults/admin-defaults.html',
];

test('probe: nessun errore runtime all\'apertura delle pagine interne', async ({ openTab }) => {
  const report = [];
  for (const url of PAGES) {
    const errs = [];
    let page;
    try {
      page = await openTab(url);
    } catch (e) {
      report.push(`${url} :: OPEN FAILED ${e.message}`);
      continue;
    }
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
    await page.waitForTimeout(2500);
    const bodyLen = await page.evaluate(() => document.body.innerText.trim().length).catch(() => -1);
    report.push(`${url} :: textLen=${bodyLen} :: ${errs.length ? errs.join(' | ') : 'ok'}`);
  }
  console.log('\n=== PROBE REPORT ===\n' + report.join('\n') + '\n=== END ===');
  expect(report.length).toBe(PAGES.length);
});
