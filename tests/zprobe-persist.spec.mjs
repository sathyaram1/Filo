// PROBE TEMPORANEO (audit prober) — non fa parte della suite stabile.
// Verifica l'invariante: una preferenza cambiata in una pagina filo:// deve
// restare cambiata dopo un reload della pagina.
import { test, expect } from './fixtures/electron.mjs';

const PAGES = [
  'filo://security/security.html',
  'filo://preferences/preferences.html',
  'filo://spellcheck/spellcheck.html',
];

for (const url of PAGES) {
  test(`persistenza checkbox — ${url}`, async ({ openTab }) => {
    const page = await openTab(url);
    await page.waitForTimeout(2500);

    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input[type=checkbox]'))
        .filter((el) => el.id && el.offsetParent !== null)
        .map((el) => el.id)
    );
    console.log(`[${url}] checkbox visibili:`, JSON.stringify(ids));

    const before = {};
    for (const id of ids) before[id] = await page.evaluate((i) => document.getElementById(i).checked, id);

    // Cambia ognuna
    for (const id of ids) {
      try {
        await page.evaluate((i) => {
          const el = document.getElementById(i);
          if (el) { el.click(); }
        }, id);
        await page.waitForTimeout(120);
      } catch (e) { console.log('click fallito', id, e.message); }
    }
    await page.waitForTimeout(1500);

    const afterClick = {};
    for (const id of ids) afterClick[id] = await page.evaluate((i) => { const e = document.getElementById(i); return e ? e.checked : null; }, id);

    await page.reload();
    await page.waitForTimeout(2500);

    const afterReload = {};
    for (const id of ids) afterReload[id] = await page.evaluate((i) => { const e = document.getElementById(i); return e ? e.checked : null; }, id);

    const lost = [];
    for (const id of ids) {
      if (afterClick[id] === null || afterReload[id] === null) continue;
      if (afterClick[id] !== afterReload[id]) lost.push({ id, before: before[id], afterClick: afterClick[id], afterReload: afterReload[id] });
    }
    console.log(`[${url}] NON PERSISTITE:`, JSON.stringify(lost, null, 2));
  });
}
