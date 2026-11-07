// Esplorazione: nel menu del tasto destro le icone hanno due etichette insieme?
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

async function prova(page, nome) {
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#bersaglio'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('#bersaglio').click({ button: 'right' });
  const m = menuDi(page);
  await expect(m.locator('.sn-menu').first()).toBeVisible();
  const cand = await m.valuta(() => [...document.querySelectorAll('.sn-menu button, .sn-menu [title]')].filter((b) => b.getBoundingClientRect().width > 0)
    .map((b, i) => { b.setAttribute('data-cand', String(i)); return [i, b.className, (b.textContent || '').trim().slice(0, 20), b.getAttribute('aria-label'), b.getAttribute('title')]; }));
  console.log(nome, 'cand', JSON.stringify(cand));
  const scelto = cand.find((c) => c[3] && !/[\p{L}\p{N}]/u.test(c[2])) || cand.find((c) => c[4]);
  const icona = m.locator(`[data-cand="${scelto[0]}"]`);
  await icona.hover({ force: true });
  await m.superficie.waitForTimeout(1200);
  const stato = await m.valuta(() => {
    const vis = (el) => !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== 'none';
    const own = [...document.querySelectorAll('.sn-tooltip')].filter(vis).map((e) => e.textContent);
    const tip = window.SN_SUGGERIMENTO?.aperto?.() || null;
    return { own, modulo: tip && tip.testo, url: location.href };
  });
  console.log(nome, JSON.stringify(stato));
  await m.superficie.screenshot({ path: `/tmp/claude-0/-home-user-Filo/2a452da3-2895-5eea-97ac-497fca87a12d/scratchpad/menu-${nome}.png` });
}

test('pagina di Filo', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  await page.evaluate(() => {
    const p = document.createElement('p'); p.id = 'bersaglio'; p.textContent = 'Una frase da cliccare col destro.';
    p.style.cssText = 'position:fixed;left:200px;top:200px;z-index:2147480000;background:#fff;padding:8px';
    document.body.appendChild(p);
  });
  await prova(page, 'filo');
});

test.describe('strato', () => {
  test.use({ stratoDelMenu: true });
  test('sito', async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px"><p id="bersaglio">Una frase da cliccare col destro.</p></body>');
    await prova(page, 'sito');
  });
});
