import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const LINK = 'https://example.com/articolo-lungo';
function pagina() {
  return `<!doctype html><html><body oncontextmenu="return false" style="margin:0;font:16px sans-serif">
    <div style="height:40vh;padding:16px">Testo in cima alla pagina.</div>
    <a id="link" href="${LINK}" style="display:inline-block;padding:8px">un collegamento</a>
    <div style="height:300vh;padding:16px">Tanta pagina sotto, tutta scorrevole.</div>
  </body></html>`;
}

const stato = (page) => menuDi(page).valuta(() => {
  const m = document.querySelector('.sn-menu:not(.sn-menu-sub)');
  const f = m && m.querySelector('.sn-menu-split-arrow');
  const sub = document.querySelector('.sn-menu-sub');
  const fum = document.querySelector('[data-sn-fumetto]');
  return {
    t: performance.now() | 0,
    st: m && m.scrollTop, sh: m && m.scrollHeight, ch: m && m.clientHeight, mt: m && Math.round(m.getBoundingClientRect().top),
    ft: f && Math.round(f.getBoundingClientRect().top), sub: sub && Math.round(sub.getBoundingClientRect().top),
    fum: fum ? getComputedStyle(fum).display : 'nessuno', aperto: globalThis.SN_SUGGERIMENTO?.aperto?.()?.testo || null,
    inline: (() => { const b = m && m.querySelector('.sn-menu-inline'); return b ? `${b.style.minHeight}/${Math.round(b.getBoundingClientRect().height)}` : null; })(),
    voci: m ? m.querySelectorAll('.sn-menu-item').length : 0,
  };
});

test('diag', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await page.locator('#link').click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-inline')).toBeVisible();
  console.log('aperto', JSON.stringify(await stato(page)));
  await menuDi(page).valuta(() => {
    const box = document.querySelector('.sn-menu:not(.sn-menu-sub) .sn-menu-inline');
    box.style.minHeight = `${window.innerHeight + 600}px`;
  });
  await expect.poll(async () => { const s = await stato(page); return s.sh > s.ch + 1; }, { timeout: 5000 }).toBe(true);
  console.log('scorrevole', JSON.stringify(await stato(page)));
  const freccetta = menu.locator('.sn-menu-split-arrow').first();
  await expect(freccetta).toBeVisible();
  await freccetta.click();
  await expect(menuDi(page).locator('.sn-menu-sub')).toBeVisible();
  console.log('prima', JSON.stringify(await stato(page)));
  await menuDi(page).valuta(() => { document.querySelector('.sn-menu:not(.sn-menu-sub)').scrollTop = 20; });
  for (let i = 0; i < 6; i++) { console.log('dopo', JSON.stringify(await stato(page))); await page.waitForTimeout(150); }
  const s = await stato(page);
  expect(s.ft).toBeLessThan(50);
});
