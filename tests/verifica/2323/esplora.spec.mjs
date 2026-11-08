// Esplorazione: col clic del test di main (senza attesa della comparsa) da dove parte lo scorrimento del menu, e il
// pannello segue la freccetta quando lo scorrimento la porta GIÙ invece che su?
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const LINK = 'https://example.com/articolo-lungo';
const pagina = `<!doctype html><html><body oncontextmenu="return false" style="margin:0;font:16px sans-serif">
    <div style="height:40vh;padding:16px">Testo in cima alla pagina.</div>
    <a id="link" href="${LINK}" style="display:inline-block;padding:8px">un collegamento</a>
    <div style="height:300vh;padding:16px">Tanta pagina sotto, tutta scorrevole.</div>
  </body></html>`;

async function stato(page) {
  return menuDi(page).valuta(() => {
    const menu = document.querySelector('.sn-menu:not(.sn-menu-sub)');
    const f = menu && menu.querySelector('.sn-menu-split-arrow');
    const sub = document.querySelector('.sn-menu-sub');
    return {
      st: menu ? Math.round(menu.scrollTop) : null,
      menuTop: menu ? Math.round(menu.getBoundingClientRect().top) : null,
      ancora: f ? Math.round(f.getBoundingClientRect().top) : null,
      pann: sub ? Math.round(sub.getBoundingClientRect().top) : null,
      pannH: sub ? Math.round(sub.getBoundingClientRect().height) : null,
      nSub: document.querySelectorAll('.sn-menu-sub').length,
      subs: [...document.querySelectorAll('.sn-menu-sub')].map((s) => `${Math.round(s.getBoundingClientRect().top)}:${(s.textContent || '').trim().slice(0, 40)}`),
      vh: window.innerHeight,
    };
  });
}

for (const modo of ['clic-subito', 'scorso-47']) {
  test(`esplora ${modo}`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, pagina);
    await page.locator('#link').click({ button: 'right' });
    const menu = menuDi(page).locator('.sn-menu');
    await expect(menu.locator('.sn-menu-inline')).toBeVisible();
    await menuDi(page).valuta(() => {
      document.querySelector('.sn-menu:not(.sn-menu-sub) .sn-menu-inline').style.minHeight = `${window.innerHeight + 600}px`;
    });
    if (modo === 'scorso-47') {
      await page.waitForTimeout(400);
      await menuDi(page).valuta(() => { document.querySelector('.sn-menu:not(.sn-menu-sub)').scrollTop = 30; });
      await page.waitForTimeout(200);
    }
    const f = menu.locator('.sn-menu-split-arrow').first();
    await f.click();
    await expect(menuDi(page).locator('.sn-menu-sub')).toBeVisible();
    const prima = await stato(page);
    await menuDi(page).valuta(() => { document.querySelector('.sn-menu:not(.sn-menu-sub)').scrollTop = 0; });
    await page.waitForTimeout(500);
    const dopo = await stato(page);
    console.log('ESPLORA', modo, JSON.stringify({ prima, dopo }));
  });
}
