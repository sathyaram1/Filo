// PROBE TEMPORANEO — sweep visivo/funzionale delle pagine filo://
import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const PAGES = [
  'archive/archive.html',
  'board/board.html',
  'credits/credits.html',
  'decks/decks.html',
  'editor/editor.html',
  'feedback/feedback.html',
  'history/history.html',
  'home/home.html',
  'options/options.html',
  'options/altro.html',
  'preferences/preferences.html',
  'security/security.html',
  'spellcheck/spellcheck.html',
];

test('sweep pagine filo://', async ({ app, shell, openTab }) => {
  test.setTimeout(300_000);
  mkdirSync('tests/.shots', { recursive: true });
  const report = [];
  for (const p of PAGES) {
    const url = `filo://${p}`;
    const errs = [];
    let page;
    try {
      page = await openTab(url);
    } catch (e) {
      report.push({ p, fatal: String(e).slice(0, 200) });
      continue;
    }
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
    await page.waitForTimeout(2500);
    // icone cliccabili senza tooltip/aria-label
    const noTip = await page.evaluate(() => {
      const out = [];
      for (const b of document.querySelectorAll('button, [role="button"]')) {
        const r = b.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const txt = (b.textContent || '').trim();
        const hasTip = b.title || b.getAttribute('aria-label');
        if (!txt && !hasTip) out.push((b.id || b.className || b.tagName) + '');
      }
      return out;
    });
    await page.screenshot({ path: `tests/.shots/sweep-${p.split('/')[0]}.png`, fullPage: false }).catch(() => {});
    report.push({ p, errs, noTip });
  }
  console.log('REPORT ' + JSON.stringify(report, null, 1));
});
