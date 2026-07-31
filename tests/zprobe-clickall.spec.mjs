// PROBE TEMPORANEO — clicca ogni controllo di ogni pagina filo:// e osserva
// se succede qualcosa (DOM cambia / nuova tab / errore). Un bottone che non fa
// NULLA è un candidato "controllo morto".
import { test, expect } from './fixtures/electron.mjs';

const PAGES = [
  'archive/archive.html',
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

test('click su tutti i controlli', async ({ app, openTab }) => {
  test.setTimeout(900_000);
  const report = [];
  for (const p of PAGES) {
    const url = `filo://${p}`;
    const page = await openTab(url);
    await page.waitForTimeout(1500);
    const n = await page.evaluate(() => {
      window.__probeBtns = [...document.querySelectorAll('button, [role="button"], a[href]')]
        .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      return window.__probeBtns.length;
    });
    for (let i = 0; i < n; i++) {
      const errs = [];
      const onErr = (e) => errs.push('PAGEERROR ' + String(e).slice(0, 160));
      const onCons = (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); };
      page.on('pageerror', onErr); page.on('console', onCons);
      const before = await page.evaluate(() => document.body.innerHTML.length + '|' + document.body.innerHTML.slice(0, 0));
      const label = await page.evaluate((i) => {
        const b = window.__probeBtns[i];
        if (!b) return null;
        return (b.id || '') + '#' + (b.textContent || '').trim().slice(0, 30) + '#' + b.className;
      }, i);
      if (label === null) break;
      const clicked = await page.evaluate((i) => {
        const b = window.__probeBtns[i];
        if (!b || !b.isConnected) return false;
        b.click();
        return true;
      }, i).catch(() => false);
      await page.waitForTimeout(700);
      let after = null;
      try { after = await page.evaluate(() => document.body.innerHTML.length + '|'); } catch (_) { after = 'GONE'; }
      const windows = app.windows().length;
      page.off('pageerror', onErr); page.off('console', onCons);
      const changed = after !== before;
      if (!changed || errs.length) {
        report.push({ p, label, clicked, changed, errs, windows });
      }
      // ripristina lo stato: ricarica la pagina e ricostruisci l'elenco
      try {
        await page.reload();
        await page.waitForTimeout(900);
        await page.evaluate(() => {
          window.__probeBtns = [...document.querySelectorAll('button, [role="button"], a[href]')]
            .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        });
      } catch (_) { break; }
    }
  }
  console.log('DEADCTRL ' + JSON.stringify(report, null, 1));
});
