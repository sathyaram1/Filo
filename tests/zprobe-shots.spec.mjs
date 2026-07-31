import { test, expect } from './fixtures/electron.mjs';

const PAGES = [
  ['prefs', 'filo://preferences/preferences.html'],
  ['security', 'filo://security/security.html'],
  ['options', 'filo://options/options.html'],
  ['credits', 'filo://credits/credits.html'],
  ['redteam', 'filo://redteam/redteam.html'],
  ['spellcheck', 'filo://spellcheck/spellcheck.html'],
  ['home', 'filo://home/home.html'],
];

test('screenshot pagine', async ({ openTab }) => {
  for (const [name, url] of PAGES) {
    const page = await openTab(url);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `tests/.shots/probe-${name}.png`, fullPage: true }).catch((e) => console.log(name, 'shot fail', e.message));
  }
});
