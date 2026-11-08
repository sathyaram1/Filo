import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const LINK = 'https://example.com/articolo-lungo';
function pagina() {
  return `<!doctype html><html><body oncontextmenu="return false" style="margin:0;font:16px sans-serif">
    <div style="height:40vh;padding:16px">Testo in cima alla pagina.</div>
    <a id="link" href="${LINK}" style="display:inline-block;padding:8px">un collegamento</a>
    <div style="height:300vh;padding:16px">Tanta pagina sotto, tutta scorrevole.</div>
    <script>window.__menuDelSito = 1</script>
  </body></html>`;
}

test('diag', async ({ openTab, testServer }) => {
  const src = await import('node:fs').then((f) => f.readFileSync(new URL('./context-menu-grow.spec.mjs', import.meta.url), 'utf8'));
  void src;
  const page = await testServer.openReady(openTab, pagina());
  await page.locator('#link').click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu.first()).toBeVisible();
  await menuDi(page).valuta(() => {
    const box = document.querySelector('.sn-menu:not(.sn-menu-sub) .sn-menu-inline');
    if (box) box.style.minHeight = `${window.innerHeight + 600}px`;
  });
  await page.waitForTimeout(300);
  const freccette = await menuDi(page).locator('.sn-menu-split-arrow').count();
  console.log('freccette', freccette);
  if (!freccette) return;
  await menuDi(page).locator('.sn-menu-split-arrow').first().click();
  const stato = () => menuDi(page).valuta(() => {
    const m = document.querySelector('.sn-menu:not(.sn-menu-sub)');
    const f = m && m.querySelector('.sn-menu-split-arrow');
    const sub = document.querySelector('.sn-menu-sub');
    const fum = document.querySelector('[data-sn-fumetto]');
    return {
      t: performance.now() | 0,
      st: m && m.scrollTop, sh: m && m.scrollHeight, ch: m && m.clientHeight,
      ft: f && Math.round(f.getBoundingClientRect().top), sub: sub && Math.round(sub.getBoundingClientRect().top),
      fum: fum ? getComputedStyle(fum).display : 'nessuno', aperto: globalThis.SN_SUGGERIMENTO?.aperto?.()?.testo || null,
      active: document.activeElement && (document.activeElement.className || document.activeElement.tagName),
    };
  });
  for (const ms of [0, 200, 400, 700]) { await page.waitForTimeout(ms ? 200 : 0); console.log('dopo clic', JSON.stringify(await stato())); }
  await menuDi(page).valuta(() => { document.querySelector('.sn-menu:not(.sn-menu-sub)').scrollTop = 20; });
  console.log('subito', JSON.stringify(await stato()));
  await page.waitForTimeout(300);
  console.log('300ms', JSON.stringify(await stato()));
});
