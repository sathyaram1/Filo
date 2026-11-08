import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const LINK = 'https://example.com/articolo-lungo';
const pagina = () => `<!doctype html><html><body oncontextmenu="return false" style="margin:0;font:16px sans-serif">
  <div style="height:40vh;padding:16px">Testo in cima alla pagina.</div>
  <a id="link" href="${LINK}" style="display:inline-block;padding:8px">un collegamento</a>
  <div style="height:300vh;padding:16px">Tanta pagina sotto, tutta scorrevole.</div>
</body></html>`;

test('quante volte riparte la comparsa', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await page.locator('#link').click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu.locator('.sn-menu-inline')).toBeVisible();
  await menuDi(page).valuta(() => {
    const m = document.querySelector('.sn-menu:not(.sn-menu-sub)');
    globalThis.__avvii = [];
    m.addEventListener('animationstart', (e) => globalThis.__avvii.push(`${e.animationName}@${performance.now() | 0}`));
    globalThis.__par = m.parentNode && m.parentNode.nodeName;
  });
  await menuDi(page).valuta(() => {
    document.querySelector('.sn-menu:not(.sn-menu-sub) .sn-menu-inline').style.minHeight = `${window.innerHeight + 600}px`;
  });
  await page.waitForTimeout(300);
  const f = menu.locator('.sn-menu-split-arrow').first();
  const b = await menuDi(page).valuta(() => { const r = document.querySelector('.sn-menu-split-arrow').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(b.x, b.y);
  await page.waitForTimeout(1200);
  console.log('stato', JSON.stringify(await menuDi(page).valuta(() => ({
    avvii: globalThis.__avvii, par: globalThis.__par,
    fumetto: !!document.querySelector('[data-sn-fumetto]'), aperto: globalThis.SN_SUGGERIMENTO?.aperto?.()?.testo || null,
    figli: [...document.documentElement.children].map((n) => n.nodeName + (n.className ? '.' + String(n.className).slice(0, 20) : '') + (n.hasAttribute && n.hasAttribute('data-sn-fumetto') ? '[fumetto]' : '')),
    corre: document.querySelector('.sn-menu:not(.sn-menu-sub)').getAnimations().map((a) => a.playState),
  }))));
  void f;
});

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
