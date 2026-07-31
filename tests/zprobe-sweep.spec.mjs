// SPEC TEMPORANEO DI AUDIT (prober) — sweep visivo/interattivo sulle pagine interne.

import { test, expect } from './fixtures/electron.mjs';

const PAGES = [
  'filo://home/home.html',
  'filo://dashboard/dashboard.html',
  'filo://archive/archive.html',
  'filo://history/history.html',
  'filo://spellcheck/spellcheck.html',
  'filo://preferences/preferences.html',
  'filo://security/security.html',
  'filo://options/options.html',
  'filo://credits/credits.html',
  'filo://board/board.html',
  'filo://decks/decks.html',
  'filo://feedback/feedback.html',
];

for (const url of PAGES) {
  const slug = url.replace(/^filo:\/\//, '').replace(/[\/.]/g, '-');
  test(`sweep ${url}`, async ({ openTab }) => {
    const page = await openTab(url);
    await page.waitForTimeout(1500);
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    const body = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      title: document.title,
      text: (document.body.innerText || '').slice(0, 500),
    }));
    console.log(`--- ${url}`, JSON.stringify(body));
    await page.screenshot({ path: `tests/.shots/sweep-${slug}.png`, fullPage: false });
    if (body.scrollW > body.clientW + 2) console.log('!! OVERFLOW ORIZZONTALE', url, body.scrollW, body.clientW);
    if (errs.length) console.log('!! PAGE ERRORS', url, errs);
  });
}
