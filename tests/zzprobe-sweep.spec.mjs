// PROBE temporaneo (audit prober): apre le pagine interne e raccoglie errori
// di console / stati vuoti sospetti. Non è un test di regressione.
import { test, expect } from './fixtures/electron.mjs';

const PAGES = [
  'filo://home/home.html',
  'filo://dashboard/dashboard.html',
  'filo://editor/editor.html',
  'filo://decks/decks.html',
  'filo://options/options.html',
  'filo://preferences/preferences.html',
  'filo://history/history.html',
  'filo://archive/archive.html',
  'filo://feedback/feedback.html',
  'filo://board/board.html',
  'filo://credits/credits.html',
  'filo://security/security.html',
  'filo://spellcheck/spellcheck.html',
  'filo://manage/manage.html',
];

test('sweep pagine interne: console errors', async ({ openTab }) => {
  test.setTimeout(240000);
  const report = [];
  for (const url of PAGES) {
    const errs = [];
    let page;
    try {
      page = await openTab(url);
    } catch (e) {
      report.push(`${url} -> OPEN FAIL ${e.message}`);
      continue;
    }
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e.message).slice(0, 200)));
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => ({
      title: document.title,
      bodyLen: (document.body.innerText || '').trim().length,
      first: (document.body.innerText || '').trim().slice(0, 120).replace(/\s+/g, ' '),
    }));
    report.push(`${url} -> title="${info.title}" len=${info.bodyLen} first="${info.first}" errs=${JSON.stringify(errs)}`);
  }
  console.log('\n===PROBE===\n' + report.join('\n') + '\n===END===\n');
});
