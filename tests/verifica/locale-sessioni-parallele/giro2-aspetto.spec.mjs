// Giro 2: come si vede il riquadro quando ha qualcosa da dire. L'avviso del
// prioritario escluso è nato nel giro 1 e non l'ha mai guardato nessuno sul
// tema scuro: una scritta che sul fondo scuro non si legge è un avviso che non
// c'è.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';
const SHOTS = 'tests/.shots';

async function apri(page, tema) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.emulateMedia({ colorScheme: tema });
  await page.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, tema);
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') {
        return { ok: true, maxSessions: 6, priorityAccount: 'A', accountAOff: true, accountBOff: false };
      }
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadSessions());
  await page.waitForTimeout(250);
}

// Contrasto secondo WCAG: sotto 3:1 una scritta piccola sul suo fondo non si legge.
function rapporto(rgb1, rgb2) {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(rgb1); const b = lum(rgb2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const tema of ['light', 'dark']) {
  test(`l'avviso del prioritario escluso si legge sul tema ${tema}`, async ({ openTab }) => {
    const page = await openTab(URL);
    await apri(page, tema);

    const warn = page.locator('#mgPriorityWarn');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('escluso');

    mkdirSync(SHOTS, { recursive: true });
    await page.locator('#mgPriorityAccountBlock').screenshot({ path: `${SHOTS}/giro2-priorita-${tema}.png` });

    const colori = await page.evaluate(() => {
      const el = document.getElementById('mgPriorityWarn');
      const leggi = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
      let n = el; let sfondo = 'rgba(0, 0, 0, 0)';
      while (n && sfondo.startsWith('rgba(0, 0, 0, 0')) {
        sfondo = getComputedStyle(n).backgroundColor; n = n.parentElement;
      }
      return { testo: leggi(getComputedStyle(el).color), sfondo: leggi(sfondo) };
    });
    expect(rapporto(colori.testo, colori.sfondo)).toBeGreaterThan(3);
  });
}
