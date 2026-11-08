import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const LINK = 'https://example.com/articolo-lungo';
const pagina = () => `<!doctype html><html><body oncontextmenu="return false" style="margin:0;font:16px sans-serif">
  <div style="height:40vh;padding:16px">Testo in cima alla pagina.</div>
  <a id="link" href="${LINK}" style="display:inline-block;padding:8px">un collegamento</a>
  <div style="height:300vh;padding:16px">Tanta pagina sotto, tutta scorrevole.</div>
</body></html>`;

for (const durante of [true, false]) {
  test(`clic sulla freccetta ${durante ? 'durante' : 'dopo'} la comparsa`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, pagina());
    await page.locator('#link').click({ button: 'right' });
    const menu = menuDi(page).locator('.sn-menu');
    await expect(menu.locator('.sn-menu-inline')).toBeVisible();
    await menuDi(page).valuta(() => {
      document.querySelector('.sn-menu:not(.sn-menu-sub) .sn-menu-inline').style.minHeight = `${window.innerHeight + 600}px`;
    });
    await expect.poll(() => menuDi(page).valuta(() => { const m = document.querySelector('.sn-menu:not(.sn-menu-sub)'); return m.scrollHeight > m.clientHeight + 1; })).toBe(true);
    if (durante) {
      await menuDi(page).valuta(() => {
        const m = document.querySelector('.sn-menu:not(.sn-menu-sub)');
        m.style.animation = 'none'; void m.offsetHeight; m.style.animation = 'sn-fade-in 1500ms ease-out';
      });
    }
    const geo = () => menuDi(page).valuta(() => {
      const m = document.querySelector('.sn-menu:not(.sn-menu-sub)');
      const f = m.querySelector('.sn-menu-split-arrow');
      return { st: Math.round(m.scrollTop), mt: Math.round(m.getBoundingClientRect().top), ft: Math.round(f.getBoundingClientRect().top), vh: innerHeight };
    });
    console.log('prima del clic', JSON.stringify(await geo()));
    await menu.locator('.sn-menu-split-arrow').first().click();
    await expect(menuDi(page).locator('.sn-menu-sub')).toBeVisible();
    console.log('dopo il clic', JSON.stringify(await geo()));
  });
}
