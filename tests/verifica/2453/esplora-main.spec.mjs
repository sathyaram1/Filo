// Esplorazione, da togliere: lo stesso caso col menu di Rinomina com'è su main.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const MAIN = readFileSync(process.env.RINOMINA_MAIN, 'utf8');

test('esplora: su main lo scorrimento finito prima chiude il menu', async ({ app }) => {
  test.setTimeout(90_000);
  try {
    const dir = cartellaTemporanea('filo-2453-');
    const file = join(dir, 'scan_00231.pdf');
    writeFileSync(file, '%PDF-1.4\n');
    await modelloFinto(app, [
      { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: file, etichetta: 'scan_00231.pdf' }) }] },
      { text: 'Eccolo.' },
    ]);
    const page = await home(app);
    if (process.env.RINOMINA_MAIN_ATTIVO) await page.evaluate((src) => { (0, eval)(src); }, MAIN);
    await chiedi(page, 'trova la scansione');
    await expect(page.locator('.dash-file-btn').first()).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => /scorsoDopo/.test(window.SN_RINOMINA_UI.menu.toString()))).toBe(!process.env.RINOMINA_MAIN_ATTIVO);
    await page.evaluate(() => {
      const b = document.querySelector('.dash-file-btn');
      const s = b.closest('.dash-bubbles');
      const z = document.createElement('div'); z.style.cssText = 'height:3000px;flex:none'; s.appendChild(z);
      b.scrollIntoView({ block: 'center' });
    });
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--sn-radius', '0px');
      window.__log = [];
      const M = window.SN_MENU;
      window.__log.push('SN_MENU ' + typeof M + ' ' + typeof (M && M.fotoDelloScorrimento));
      if (M && M.fotoDelloScorrimento) {
        const orig = M.fotoDelloScorrimento;
        M.fotoDelloScorrimento = (x, y) => {
          const el = document.elementFromPoint(x, y);
          window.__log.push('foto ' + x + ',' + y + ' ' + (el && el.className));
          const f = orig(x, y);
          return (e) => { const v = f(e); window.__log.push('scroll ' + (e.target.className || e.target.nodeName) + ' -> ' + v); return v; };
        };
      }
      document.addEventListener('scroll', (e) => window.__log.push('ev ' + (e.target.className || e.target.nodeName) + ' t=' + Math.round(performance.now())), true);
    });
    await page.evaluate(async () => {
      await window.SN_RINOMINA_UI.disponibile();
      window.__log.push('click t=' + Math.round(performance.now()));
      const b = document.querySelector('.dash-file-btn');
      b.closest('.dash-bubbles').scrollTop += 40;
      const r = b.getBoundingClientRect();
      b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + r.height / 2, button: 2 }));
    });
    const menu = page.locator('.sn-rinomina-menu');
    await expect(menu).toBeVisible();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200)))));
    console.log(JSON.stringify(await page.evaluate(() => window.__log), null, 1));
    await expect(menu).toBeVisible();
  } finally {
    await ripristina(app);
  }
});
